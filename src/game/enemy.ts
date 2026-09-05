import * as THREE from 'three';
import type { CharacterSpec } from '../types';
import { buildPaperDoll, type PaperDoll } from './paperDoll';
import type { Mask } from '../studio/rig';
import { LAYER_PAPER } from '../ink/paperPass';
import { resolveCollision, segmentBlocked } from './world';
import { aimPoint, type ProjectileSystem, type Target } from './weapon';
import type { resolveWeapon } from '../types';

/** Overbright white: a hit blanches the figure for a moment. */
const FLASH = new THREE.Color(2.4, 2.0, 2.0);

export interface EnemyKind {
  name: string;
  hp: number;
  speed: number;
  /** Preferred distance to hold from the player. */
  standoff: number;
  fireInterval: number;
  damage: number;
  score: number;
  scale: number;
}

export const KINDS: Record<string, EnemyKind> = {
  grunt:  { name: 'grunt',  hp: 55,  speed: 3.2, standoff: 9,  fireInterval: 1.35, damage: 8,  score: 100, scale: 1 },
  rusher: { name: 'rusher', hp: 38,  speed: 6.1, standoff: 1.6, fireInterval: 0.9, damage: 14, score: 150, scale: 0.9 },
  marks:  { name: 'marks',  hp: 45,  speed: 2.0, standoff: 20, fireInterval: 2.1,  damage: 20, score: 200, scale: 1.05 },
  brute:  { name: 'brute',  hp: 240, speed: 2.4, standoff: 6,  fireInterval: 1.1,  damage: 16, score: 500, scale: 1.5 },
};

export class Enemy implements Target {
  readonly doll: PaperDoll;
  readonly position = new THREE.Vector3();
  /** All three change with the kind the slot is recycled into. */
  kind: EnemyKind;
  radius: number;
  height: number;
  hp: number;
  alive = true;
  /** Set the moment it dies, cleared by whoever awards the points. */
  killPending = false;
  private velY = 0;
  private fireTimer: number;
  private strafe = Math.random() < 0.5 ? 1 : -1;
  private strafeTimer = 1 + Math.random() * 2;
  private hurtFlash = 0;
  private deadFor = 0;
  private clock = Math.random() * 10;

  constructor(
    kind: EnemyKind,
    private readonly baseHeight: number,
    spec: CharacterSpec,
    texture: THREE.Texture,
    mask: Mask | null,
    private scene: THREE.Scene,
    private colliders: THREE.Box3[],
  ) {
    // Built once at natural size; the kind is applied as a scale on reset, so
    // one pool of dolls can serve grunts and brutes alike.
    this.doll = buildPaperDoll(spec, texture, mask);
    this.kind = kind;
    this.height = baseHeight * kind.scale;
    this.radius = 0.42 * kind.scale;
    this.hp = kind.hp;
    this.fireTimer = 0.4 + Math.random() * kind.fireInterval;
    scene.add(this.doll.root);
  }

  spawnAt(p: THREE.Vector3) {
    this.position.copy(p);
    this.placeDoll();
  }

  /** `position` tracks the crown; the cut-out is anchored at the soles. */
  private placeDoll() {
    this.doll.root.position.set(this.position.x, this.position.y - this.height, this.position.z);
  }

  hit(damage: number, _from: THREE.Vector3) {
    if (!this.alive) return;
    this.hp -= damage;
    this.hurtFlash = 0.18;
    if (this.hp <= 0) { this.alive = false; this.deadFor = 0; this.killPending = true; }
  }

  /** Returns true once the corpse has finished falling and can be recycled. */
  update(
    dt: number, player: Target, projectiles: ProjectileSystem,
    weapon: ReturnType<typeof resolveWeapon>,
  ): boolean {
    this.clock += dt;

    if (!this.alive) {
      this.deadFor += dt;
      this.doll.setPose('dead', this.clock, 0);
      this.placeDoll();
      this.faceCameraless(player.position);
      return this.deadFor > 2.2;
    }

    const toPlayer = player.position.clone().sub(this.position);
    toPlayer.y = 0;
    const dist = toPlayer.length();
    const dir = dist > 1e-3 ? toPlayer.clone().divideScalar(dist) : new THREE.Vector3(0, 0, 1);
    const eye = this.position.clone().setY(this.position.y + this.height * 0.72);
    const playerEye = aimPoint(player);
    const canSee = !segmentBlocked(eye, playerEye, this.colliders);

    this.strafeTimer -= dt;
    if (this.strafeTimer <= 0) { this.strafe *= -1; this.strafeTimer = 0.9 + Math.random() * 1.8; }

    const move = new THREE.Vector3();
    // Close the gap when out of range, back off when too close, circle in between.
    const gap = dist - this.kind.standoff;
    if (Math.abs(gap) > 1.2) move.addScaledVector(dir, Math.sign(gap));
    if (canSee) move.addScaledVector(new THREE.Vector3(-dir.z, 0, dir.x), this.strafe * 0.75);
    if (move.lengthSq() > 0) move.normalize().multiplyScalar(this.kind.speed * dt);

    this.position.add(move);
    this.velY -= 22 * dt;
    this.position.y += this.velY * dt;
    if (this.position.y < this.height) { this.position.y = this.height; this.velY = 0; }
    const feetPos = this.position.clone();
    resolveCollision(feetPos, this.radius, this.height, this.colliders);
    this.position.copy(feetPos);

    this.fireTimer -= dt;
    if (canSee && this.fireTimer <= 0 && dist < 34) {
      this.fireTimer = this.kind.fireInterval * (0.75 + Math.random() * 0.5);
      const aim = playerEye.clone().sub(eye).normalize();
      // Aim wobbles, so nothing feels like a laser from across the map.
      aim.x += (Math.random() - 0.5) * 0.06;
      aim.y += (Math.random() - 0.5) * 0.04;
      aim.z += (Math.random() - 0.5) * 0.06;
      projectiles.spawn(eye, aim.normalize(), { ...weapon, damage: this.kind.damage }, false);
    }

    this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    this.doll.setTint(FLASH, this.hurtFlash > 0 ? 1 : 0);
    const speed = move.length() / Math.max(dt, 1e-4);
    this.doll.setPose(
      this.hurtFlash > 0 ? 'hurt' : speed > 0.6 ? 'run' : canSee ? 'aim' : 'idle',
      this.clock, speed / Math.max(1, this.kind.speed),
    );
    this.placeDoll();
    this.faceCameraless(player.position);
    return false;
  }

  /** Cut-outs have no back, so they always turn their page toward the viewer. */
  private faceCameraless(viewer: THREE.Vector3) {
    this.doll.root.rotation.y = Math.atan2(viewer.x - this.position.x, viewer.z - this.position.z);
  }

  reset(kind: EnemyKind) {
    this.kind = kind;
    this.alive = true;
    this.killPending = false;
    this.hp = kind.hp;
    this.height = this.baseHeight * kind.scale;
    this.radius = 0.42 * kind.scale;
    this.deadFor = 0;
    this.velY = 0;
    this.fireTimer = 0.4 + Math.random() * kind.fireInterval;
    this.doll.root.scale.setScalar(kind.scale);
    this.doll.root.rotation.set(0, 0, 0);
    this.placeDoll();
  }

  dispose() {
    this.scene.remove(this.doll.root);
    this.doll.dispose();
  }
}

/** Ink that stays on the page. Kills leave a mark you walk past all match. */
export class SplatField {
  private meshes: THREE.Mesh[] = [];
  private next = 0;
  private geo = new THREE.PlaneGeometry(1, 1);
  private textures: THREE.Texture[] = [];

  constructor(private scene: THREE.Scene, private max = 40) {
    for (let i = 0; i < 4; i++) this.textures.push(new THREE.CanvasTexture(splatCanvas()));
  }

  add(at: THREE.Vector3, size = 1.6) {
    let mesh = this.meshes[this.next];
    if (!mesh) {
      mesh = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({
        transparent: true, depthWrite: false, toneMapped: false, opacity: 0.9,
      }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.layers.set(LAYER_PAPER);
      mesh.renderOrder = 1;
      this.scene.add(mesh);
      this.meshes[this.next] = mesh;
    }
    const mat = mesh.material as THREE.MeshBasicMaterial;
    mat.map = this.textures[(Math.random() * this.textures.length) | 0];
    mat.needsUpdate = true;
    mesh.position.set(at.x, 0.03 + Math.random() * 0.01, at.z);
    mesh.rotation.z = Math.random() * Math.PI * 2;
    mesh.scale.setScalar(size * (0.7 + Math.random() * 0.7));
    mesh.visible = true;
    this.next = (this.next + 1) % this.max;
  }

  clear() { this.meshes.forEach((m) => (m.visible = false)); this.next = 0; }

  dispose() {
    this.meshes.forEach((m) => { this.scene.remove(m); (m.material as THREE.Material).dispose(); });
    this.geo.dispose();
    this.textures.forEach((t) => t.dispose());
  }
}

function splatCanvas(): HTMLCanvasElement {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#a8122a';
  const blob = (cx: number, cy: number, r: number) => {
    ctx.beginPath();
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const rr = r * (0.62 + Math.random() * 0.55);
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  };
  blob(s / 2, s / 2, s * 0.22);
  for (let i = 0; i < 16; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = s * (0.16 + Math.random() * 0.3);
    blob(s / 2 + Math.cos(a) * d, s / 2 + Math.sin(a) * d, s * (0.015 + Math.random() * 0.05));
  }
  return c;
}
