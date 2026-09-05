import * as THREE from 'three';
import type { CharacterSpec, WeaponSpec } from '../types';
import { InkRenderer, LAYER_PAPER, LAYER_WORLD } from '../ink/paperPass';
import { buildArena } from './world';
import { Player, makeInput } from './player';
import { ProjectileSystem, Viewmodel, WeaponInstance, type Target } from './weapon';
import { Enemy, KINDS, SplatField, type EnemyKind } from './enemy';
import { composeWave, concurrency } from './waves';
import { Hud } from './hud';
import { maskOf, type Mask } from '../studio/rig';
import { resolveWeapon } from '../types';

export interface GameOptions {
  character: CharacterSpec;
  weapons: WeaponSpec[];
  container: HTMLElement;
  onExit(score: number, wave: number): void;
}

/** Reprint a drawing in one flat colour, keeping only its silhouette. */
function recolour(source: THREE.Texture, colour: string): THREE.Texture {
  const img = source.image as HTMLImageElement;
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, c.width, c.height);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

async function loadTexture(dataUrl: string): Promise<THREE.Texture> {
  const tex = await new THREE.TextureLoader().loadAsync(dataUrl);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function maskFromTexture(tex: THREE.Texture): Mask | null {
  const img = tex.image as HTMLImageElement | undefined;
  if (!img?.width) return null;
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  c.getContext('2d', { willReadFrequently: true })!.drawImage(img, 0, 0);
  return maskOf(c);
}

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private ink: InkRenderer;
  private arena = buildArena();
  private player: Player;
  private hud = new Hud();
  private projectiles: ProjectileSystem;
  private splats: SplatField;
  private input = makeInput();
  private detach: Array<() => void> = [];
  private weapons: WeaponInstance[] = [];
  private viewmodels: Viewmodel[] = [];
  private active = 0;
  private enemies: Enemy[] = [];
  private queue: EnemyKind[] = [];
  private wave = 0;
  private score = 0;
  private intermission = 3;
  private spawnTimer = 0;
  private clock = new THREE.Clock();
  private elapsed = 0;
  private running = false;
  private over = false;
  private beam: THREE.Line;
  private beamLife = 0;
  private enemyGun = resolveWeapon({
    pips: { damage: 4, fireRate: 3, accuracy: 5, ammo: 6, reload: 4, count: 1 },
    pattern: 'straight',
  } as WeaponSpec);

  private constructor(private opts: GameOptions) {
    const el = opts.container;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(el.clientWidth, el.clientHeight);
    this.renderer.setClearColor('#fdfbf2', 1);
    el.append(this.renderer.domElement);
    el.append(this.hud.root);

    this.camera = new THREE.PerspectiveCamera(76, el.clientWidth / el.clientHeight, 0.05, 220);
    this.camera.layers.enable(LAYER_WORLD);
    this.camera.layers.enable(LAYER_PAPER);
    this.scene.add(this.camera);
    this.scene.add(this.arena.group);

    this.ink = new InkRenderer(this.renderer, this.camera);
    this.player = new Player(this.arena.colliders);
    this.projectiles = new ProjectileSystem(this.scene, this.arena.colliders);
    this.splats = new SplatField(this.scene);

    const beamGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.beam = new THREE.Line(beamGeo, new THREE.LineBasicMaterial({
      color: '#16205c', transparent: true, opacity: 0.9, toneMapped: false,
    }));
    this.beam.layers.set(LAYER_PAPER);
    this.beam.visible = false;
    this.beam.frustumCulled = false;
    this.scene.add(this.beam);
  }

  static async create(opts: GameOptions): Promise<Game> {
    const game = new Game(opts);
    await game.load();
    return game;
  }

  private async load() {
    const charTex = await loadTexture(this.opts.character.texture);
    const mask = maskFromTexture(charTex);
    const enemyTex = recolour(charTex, '#b21226');

    for (let i = 0; i < 12; i++) {
      const e = new Enemy(
        KINDS.grunt, this.opts.character.worldHeight, this.opts.character,
        enemyTex, mask, this.scene, this.arena.colliders,
      );
      e.alive = false;
      e.doll.root.visible = false;
      this.enemies.push(e);
    }

    for (const spec of this.opts.weapons.slice(0, 5)) {
      const tex = await loadTexture(spec.texture);
      this.weapons.push(new WeaponInstance(spec));
      const vm = new Viewmodel(spec, tex);
      vm.group.visible = false;
      this.camera.add(vm.group);
      this.viewmodels.push(vm);
    }
    if (this.viewmodels[0]) this.viewmodels[0].group.visible = true;

    this.player.spawn(this.arena.playerSpawn.clone(), -0.9);
    this.bind();

    if (new URLSearchParams(location.search).has('nolock')) {
      (window as unknown as Record<string, unknown>).__game = this;
    }
  }

  private bind() {
    const canvas = this.renderer.domElement;
    this.detach.push(this.input.attach(canvas));

    const onMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== canvas) return;
      this.player.look(e.movementX, e.movementY, 0.0022);
    };
    const freeLook = new URLSearchParams(location.search).has('nolock');
    const onLockChange = () => {
      this.running = (freeLook || document.pointerLockElement === canvas) && !this.over;
      this.hud.root.dataset.paused = String(!this.running);
      if (this.running) this.clock.getDelta();
    };
    const onClick = () => { if (!this.over && !freeLook) canvas.requestPointerLock(); };
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') document.exitPointerLock();
      if (e.code === 'KeyQ') this.select((this.active + 1) % Math.max(1, this.weapons.length));
    };
    const onResize = () => {
      const el = this.opts.container;
      this.camera.aspect = el.clientWidth / el.clientHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(el.clientWidth, el.clientHeight);
      this.ink.setSize(el.clientWidth, el.clientHeight);
    };

    window.addEventListener('mousemove', onMove);
    document.addEventListener('pointerlockchange', onLockChange);
    canvas.addEventListener('click', onClick);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    if (freeLook) onLockChange();
    this.detach.push(() => {
      window.removeEventListener('mousemove', onMove);
      document.removeEventListener('pointerlockchange', onLockChange);
      canvas.removeEventListener('click', onClick);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    });

    this.hud.say('click to lock the mouse · WASD move · R reload · Q swap', 4200);
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private select(index: number) {
    if (!this.weapons[index] || index === this.active) return;
    this.viewmodels[this.active]?.group && (this.viewmodels[this.active].group.visible = false);
    this.active = index;
    this.viewmodels[index].group.visible = true;
    this.hud.say(this.weapons[index].name.toUpperCase(), 900);
  }

  private aliveTargets(): Target[] {
    return this.enemies.filter((e) => e.alive && e.doll.root.visible);
  }

  private spawnFromQueue() {
    const live = this.enemies.filter((e) => e.doll.root.visible && e.alive).length;
    if (!this.queue.length || live >= concurrency(this.wave)) return;
    const slot = this.enemies.find((e) => !e.doll.root.visible);
    if (!slot) return;

    const kind = this.queue.shift()!;
    // Prefer a spawn the player is not already staring at.
    const spots = [...this.arena.enemySpawns].sort(() =>
      Math.random() - 0.5).sort((a, b) =>
      b.distanceTo(this.player.position) - a.distanceTo(this.player.position));
    const at = (spots[0] ?? this.arena.enemySpawns[0]).clone();
    at.x += (Math.random() - 0.5) * 3;
    at.z += (Math.random() - 0.5) * 3;

    slot.reset(kind);
    slot.spawnAt(at);
    slot.doll.root.visible = true;
  }

  private frame() {
    const dt = Math.min(0.05, this.clock.getDelta());
    this.elapsed += dt;
    if (this.running) this.step(dt);
    this.player.applyTo(this.camera);
    // A standing wound tints gently; a fresh one spikes and fades.
    this.ink.damage = Math.min(1,
      Math.max(0, 1 - this.player.hp / this.player.maxHp) * 0.45
      + Math.max(0, 0.35 - this.player.lastHurt) * 1.6);
    this.ink.render(this.scene, this.elapsed);
  }

  private step(dt: number) {
    const input = this.input.state;
    if (input.slot !== null) { this.select(input.slot); input.slot = null; }

    this.player.update(dt, input);

    const weapon = this.weapons[this.active];
    const vm = this.viewmodels[this.active];
    if (weapon) {
      weapon.update(dt);
      if (input.reload) weapon.reload();
      const origin = this.player.position.clone();
      const forward = this.player.forward;
      if (input.fire) {
        const res = weapon.fire(
          origin.clone().addScaledVector(forward, 0.5),
          forward, this.projectiles, this.aliveTargets(), this.arena.colliders, true,
        );
        if (res.fired) {
          vm?.kick(0.6 + weapon.recoilKick * 0.5);
          this.player.pitch = Math.min(1.5, this.player.pitch + weapon.stats.spread * 0.9 + 0.004);
          if (res.beam) {
            const pts = this.beam.geometry.attributes.position as THREE.BufferAttribute;
            pts.setXYZ(0, res.beam.from.x, res.beam.from.y - 0.08, res.beam.from.z);
            pts.setXYZ(1, res.beam.to.x, res.beam.to.y, res.beam.to.z);
            pts.needsUpdate = true;
            this.beam.visible = true;
            this.beamLife = 0.07;
          }
        }
      }
      vm?.update(dt, this.elapsed, this.player.speed, new THREE.Vector2(0, 0), weapon.reloading);
    }

    if (this.beamLife > 0 && (this.beamLife -= dt) <= 0) this.beam.visible = false;

    this.projectiles.update(dt, this.aliveTargets(), this.player);

    for (const e of this.enemies) {
      if (!e.doll.root.visible) continue;
      const done = e.update(this.debugFreeze ? 0 : dt, this.player, this.projectiles, this.enemyGun);
      // Kills land during the projectile pass, so the flag is what to read.
      if (e.killPending) {
        e.killPending = false;
        this.score += e.kind.score;
        this.splats.add(e.position, 1.2 + e.kind.scale * 0.7);
        this.hud.popup(`+${e.kind.score}`, 'kill');
      }
      if (done) e.doll.root.visible = false;
    }

    if (this.player.lastHurt < dt * 1.5) this.hud.popup('hit', 'hurt');

    const remaining = this.queue.length + this.enemies.filter((e) => e.doll.root.visible && e.alive).length;
    if (remaining === 0) {
      this.intermission -= dt;
      if (this.intermission <= 0) {
        this.wave++;
        this.queue = composeWave(this.wave);
        this.intermission = 6;
        this.weapons.forEach((w) => { w.ammo = w.magazine; w.reloading = 0; });
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + 25);
        this.hud.say(`WAVE ${this.wave}`, 1600);
      }
    } else {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) { this.spawnFromQueue(); this.spawnTimer = 0.45; }
    }

    this.hud.update({
      score: this.score, wave: this.wave, remaining,
      hp: this.player.hp, maxHp: this.player.maxHp,
      weapons: this.weapons, active: this.active,
    });

    if (!this.player.alive && !this.over) {
      this.over = true;
      this.running = false;
      document.exitPointerLock();
      this.hud.say('the page tears', 3000);
      window.setTimeout(() => this.opts.onExit(this.score, this.wave), 1400);
    }
  }

  /** Development hook, wired up only under ?nolock. */
  snapshot() {
    return {
      wave: this.wave,
      score: this.score,
      player: this.player.position.toArray(),
      camera: this.camera.position.toArray(),
      enemies: this.enemies
        .filter((e) => e.doll.root.visible)
        .map((e) => ({
          kind: e.kind.name, hp: Math.round(e.hp), alive: e.alive,
          at: e.position.toArray(),
          rootAt: e.doll.root.position.toArray(),
          parts: e.doll.root.children[0]?.children.length ?? 0,
          screen: (() => {
            const v = e.doll.root.position.clone();
            v.y += 1;
            v.project(this.camera);
            return [Number(v.x.toFixed(2)), Number(v.y.toFixed(2)), Number(v.z.toFixed(2))];
          })(),
        })),
    };
  }

  /** Development hook: hold the figures still so a frame can be inspected. */
  debugFreeze = false;

  /** Development hook: drop one enemy a few metres in front of the player. */
  debugSummon(kindName: keyof typeof KINDS = 'grunt', distance = 7) {
    const slot = this.enemies.find((e) => !e.doll.root.visible);
    if (!slot) return;
    const kind = KINDS[kindName];
    const at = this.player.position.clone()
      .addScaledVector(this.player.forward.setY(0).normalize(), distance);
    at.y = kind.scale * this.opts.character.worldHeight;
    slot.spawnAt(at);
    slot.reset(kind);
    slot.doll.root.visible = true;
  }

  /** Development hook: point the camera at a spot on the floor. */
  faceTowards(x: number, z: number) {
    this.player.yaw = Math.atan2(this.player.position.x - x, this.player.position.z - z);
    this.player.pitch = 0;
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.detach.forEach((fn) => fn());
    this.enemies.forEach((e) => e.dispose());
    this.viewmodels.forEach((v) => v.dispose());
    this.projectiles.dispose();
    this.splats.dispose();
    this.ink.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.hud.root.remove();
  }
}
