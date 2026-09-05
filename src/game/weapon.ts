import * as THREE from 'three';
import type { ResolvedWeapon, WeaponSpec } from '../types';
import { resolveWeapon } from '../types';
import { LAYER_PAPER } from '../ink/paperPass';
import { raycastBoxes, segmentBlocked } from './world';

export interface Target {
  /** Top of the body: the crown for a figure, the eye for the player. */
  position: THREE.Vector3;
  radius: number;
  height: number;
  alive: boolean;
  hit(damage: number, from: THREE.Vector3): void;
}

/**
 * Bodies are tall and thin, so they are tested as upright capsules rather
 * than as a ball somewhere in the middle of the torso.
 *
 *    o  <- position (crown)
 *    │
 *    │  body segment
 *    │
 *   ─┴─ feet
 */
export function bodySegment(t: Target, a: THREE.Vector3, b: THREE.Vector3) {
  a.set(t.position.x, t.position.y - t.height + 0.22, t.position.z);
  b.set(t.position.x, t.position.y - 0.14, t.position.z);
}

export function aimPoint(t: Target): THREE.Vector3 {
  return new THREE.Vector3(t.position.x, t.position.y - t.height * 0.4, t.position.z);
}

/** Shortest distance between two line segments. */
export function segmentDistance(
  p1: THREE.Vector3, q1: THREE.Vector3, p2: THREE.Vector3, q2: THREE.Vector3,
): number {
  const d1 = q1.clone().sub(p1);
  const d2 = q2.clone().sub(p2);
  const r = p1.clone().sub(p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let s = 0, t = 0;
  if (a <= 1e-8 && e <= 1e-8) return r.length();
  if (a <= 1e-8) {
    t = Math.min(1, Math.max(0, f / e));
  } else {
    const c = d1.dot(r);
    if (e <= 1e-8) {
      s = Math.min(1, Math.max(0, -c / a));
    } else {
      const b = d1.dot(d2);
      const denom = a * e - b * b;
      s = denom > 1e-8 ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
      else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
    }
  }
  return p1.clone().addScaledVector(d1, s).distanceTo(p2.clone().addScaledVector(d2, t));
}

interface Projectile {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  damage: number;
  bounces: number;
  pattern: ResolvedWeapon['pattern'];
  friendly: boolean;
  active: boolean;
}

const GRAVITY = 22;

export class ProjectileSystem {
  private pool: Projectile[] = [];
  private geo = new THREE.BoxGeometry(0.055, 0.055, 0.46);
  private matFriendly = new THREE.MeshBasicMaterial({ color: '#16205c', toneMapped: false });
  private matHostile = new THREE.MeshBasicMaterial({ color: '#a11527', toneMapped: false });

  constructor(private scene: THREE.Scene, private colliders: THREE.Box3[]) {}

  spawn(origin: THREE.Vector3, dir: THREE.Vector3, w: ResolvedWeapon, friendly: boolean) {
    let p = this.pool.find((q) => !q.active);
    if (!p) {
      const mesh = new THREE.Mesh(this.geo, this.matFriendly);
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      p = { mesh, vel: new THREE.Vector3(), life: 0, damage: 0, bounces: 0, pattern: 'straight', friendly, active: false };
      this.pool.push(p);
    }
    p.mesh.material = friendly ? this.matFriendly : this.matHostile;
    p.mesh.visible = true;
    p.mesh.position.copy(origin);
    p.vel.copy(dir).multiplyScalar(w.speed);
    p.life = 3.2;
    p.damage = w.damage;
    p.bounces = w.pattern === 'bounce' ? 3 : 0;
    p.pattern = w.pattern;
    p.friendly = friendly;
    p.active = true;
  }

  /** Bullets only look for the other side, so nobody shoots themselves. */
  update(dt: number, enemies: Target[], player: Target) {
    for (const p of this.pool) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) { this.retire(p); continue; }

      if (p.pattern === 'arc') p.vel.y -= GRAVITY * dt;
      if (p.pattern === 'homing') {
        let best: Target | null = null, bestD = 26;
        for (const t of (p.friendly ? enemies : [player])) {
          if (!t.alive) continue;
          const d = t.position.distanceTo(p.mesh.position);
          if (d < bestD) { bestD = d; best = t; }
        }
        if (best) {
          const want = aimPoint(best)
            .sub(p.mesh.position).normalize().multiplyScalar(p.vel.length());
          p.vel.lerp(want, Math.min(1, dt * 5.5));
        }
      }

      const step = p.vel.clone().multiplyScalar(dt);
      const next = p.mesh.position.clone().add(step);

      let consumed = false;
      for (const t of (p.friendly ? enemies : [player])) {
        if (!t.alive) continue;
        bodySegment(t, BODY_A, BODY_B);
        if (segmentDistance(p.mesh.position, next, BODY_A, BODY_B) < t.radius + 0.12) {
          t.hit(p.damage, p.mesh.position);
          consumed = true;
          break;
        }
      }
      if (consumed) { this.retire(p); continue; }

      const wall = raycastBoxes(p.mesh.position, next, this.colliders);
      if (wall) {
        if (p.bounces-- > 0) {
          p.vel.reflect(wall.normal);
          // Restart just clear of the surface so the next step is not inside it.
          p.mesh.position.copy(wall.point).addScaledVector(wall.normal, 0.05);
          continue;
        }
        this.retire(p);
        continue;
      }

      p.mesh.position.copy(next);
      p.mesh.lookAt(next.clone().add(p.vel));
    }
  }

  private retire(p: Projectile) { p.active = false; p.mesh.visible = false; }

  dispose() {
    this.pool.forEach((p) => this.scene.remove(p.mesh));
    this.geo.dispose();
    this.matFriendly.dispose();
    this.matHostile.dispose();
  }
}

const BODY_A = new THREE.Vector3();
const BODY_B = new THREE.Vector3();

export interface FireResult { fired: boolean; beam?: { from: THREE.Vector3; to: THREE.Vector3 }; }

export class WeaponInstance {
  readonly stats: ResolvedWeapon;
  ammo: number;
  reloading = 0;
  private cooldown = 0;
  /** Grows while you hold the trigger, decays when you stop. */
  private heat = 0;

  constructor(readonly spec: WeaponSpec) {
    this.stats = resolveWeapon(spec);
    this.ammo = this.stats.magazine;
  }

  get name() { return this.spec.name; }
  get magazine() { return this.stats.magazine; }
  get busy() { return this.reloading > 0; }
  get recoilKick() { return this.heat; }

  update(dt: number) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.heat = Math.max(0, this.heat - dt * 2.4);
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) { this.ammo = this.stats.magazine; this.reloading = 0; }
    }
  }

  reload() {
    if (this.reloading > 0 || this.ammo === this.stats.magazine) return;
    this.reloading = this.stats.reloadTime;
  }

  fire(
    origin: THREE.Vector3, forward: THREE.Vector3,
    projectiles: ProjectileSystem, targets: Target[], colliders: THREE.Box3[], friendly: boolean,
  ): FireResult {
    if (this.cooldown > 0 || this.reloading > 0) return { fired: false };
    if (this.ammo <= 0) { this.reload(); return { fired: false }; }

    this.cooldown = this.stats.interval;
    this.ammo--;
    this.heat = Math.min(1, this.heat + 0.34);

    const spread = this.stats.spread * (1 + this.heat * 1.6);

    if (this.stats.pattern === 'beam') {
      const end = origin.clone().addScaledVector(forward, 90);
      let closest = end, closestD = Infinity;
      for (const t of targets) {
        if (!t.alive) continue;
        bodySegment(t, BODY_A, BODY_B);
        if (segmentDistance(origin, end, BODY_A, BODY_B) > t.radius + 0.1) continue;
        const centre = aimPoint(t);
        const along = centre.clone().sub(origin).dot(forward);
        if (along < 0 || segmentBlocked(origin, centre, colliders)) continue;
        t.hit(this.stats.damage, origin);
        if (along < closestD) { closestD = along; closest = centre; }
      }
      return { fired: true, beam: { from: origin.clone(), to: closestD < Infinity ? closest : end } };
    }

    for (let i = 0; i < this.stats.projectiles; i++) {
      const dir = forward.clone();
      const yaw = (Math.random() - 0.5) * 2 * spread;
      const pitch = (Math.random() - 0.5) * 2 * spread;
      dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      dir.applyAxisAngle(new THREE.Vector3(1, 0, 0).cross(dir).normalize().negate(), pitch);
      dir.normalize();
      if (this.stats.pattern === 'arc') dir.y += 0.12;
      projectiles.spawn(origin.clone(), dir.normalize(), this.stats, friendly);
    }
    return { fired: true };
  }
}

/** A scribbled star, drawn once and reused for every muzzle flash. */
function flashTexture(): THREE.Texture {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  ctx.strokeStyle = '#1e2b78';
  ctx.lineCap = 'round';
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2 + Math.random() * 0.3;
    const len = s * (0.16 + Math.random() * 0.3);
    ctx.lineWidth = 2 + Math.random() * 4;
    ctx.beginPath();
    ctx.moveTo(s / 2, s / 2);
    ctx.lineTo(s / 2 + Math.cos(a) * len, s / 2 + Math.sin(a) * len);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** The gun you see in your own hands, hung off the camera. */
export class Viewmodel {
  readonly group = new THREE.Group();
  private mesh: THREE.Mesh;
  private material: THREE.MeshBasicMaterial;
  private flash: THREE.Mesh;
  private flashLife = 0;
  private recoil = 0;
  private sway = new THREE.Vector2();

  constructor(spec: WeaponSpec, texture: THREE.Texture) {
    this.material = new THREE.MeshBasicMaterial({
      map: texture, transparent: true, alphaTest: 0.2, depthTest: false, toneMapped: false,
    });
    const aspect = spec.width / spec.height;
    // Long weapons get scaled down so the whole thing stays on screen.
    const height = Math.min(0.30, 0.62 / Math.max(1.6, aspect));
    const geo = new THREE.PlaneGeometry(height * aspect, height);
    // Slide the quad so the drawn grip sits exactly on the group's origin.
    geo.translate((0.5 - spec.grip.x) * height * aspect, (spec.grip.y - 0.5) * height, 0);
    this.mesh = new THREE.Mesh(geo, this.material);
    // Weapons are drawn barrel-right; mirrored, the barrel points into the
    // scene from your right hand, which is where a first-person gun belongs.
    this.mesh.scale.x = -1;
    this.mesh.layers.set(LAYER_PAPER);
    this.mesh.renderOrder = 30;
    this.group.add(this.mesh);
    this.group.position.set(0.40, -0.30, -0.66);
    this.group.rotation.z = 0.2;

    // The flash hangs off the muzzle the player pinned, as a child of the
    // gun quad, so it inherits the mirror and every bit of recoil motion.
    this.flash = new THREE.Mesh(
      new THREE.PlaneGeometry(height * 0.75, height * 0.75),
      new THREE.MeshBasicMaterial({
        map: flashTexture(), transparent: true, depthTest: false,
        toneMapped: false, opacity: 0,
      }),
    );
    this.flash.position.set(
      (spec.muzzle.x - spec.grip.x) * height * aspect,
      (spec.grip.y - spec.muzzle.y) * height,
      0.001,
    );
    this.flash.layers.set(LAYER_PAPER);
    this.flash.renderOrder = 31;
    this.mesh.add(this.flash);
  }

  kick(amount = 1) {
    this.recoil = Math.min(1.4, this.recoil + amount);
    this.flashLife = 0.055;
    this.flash.rotation.z = Math.random() * Math.PI;
    this.flash.scale.setScalar(0.8 + Math.random() * 0.5);
  }

  update(dt: number, t: number, moveSpeed: number, look: THREE.Vector2, reloading: number) {
    this.recoil = Math.max(0, this.recoil - dt * 6);
    this.flashLife = Math.max(0, this.flashLife - dt);
    (this.flash.material as THREE.MeshBasicMaterial).opacity =
      this.flashLife > 0 ? Math.min(1, this.flashLife / 0.03) : 0;
    this.sway.lerp(look.clone().multiplyScalar(-0.03), Math.min(1, dt * 8));

    const bob = moveSpeed * 0.012;
    this.mesh.position.x = this.sway.x + Math.sin(t * 9) * bob + this.recoil * 0.05;
    this.mesh.position.y = this.sway.y + Math.abs(Math.cos(t * 9)) * bob - this.recoil * 0.05;
    this.mesh.position.z = this.recoil * 0.09;
    this.mesh.rotation.z = -this.recoil * 0.22 + Math.sin(t * 4.4) * 0.012;
    if (reloading > 0) {
      // Yanked out of frame and dropped back in.
      const k = Math.sin(Math.min(1, reloading) * Math.PI);
      this.mesh.position.y -= k * 0.34;
      this.mesh.rotation.z += k * 0.7;
    }
  }

  dispose() {
    this.material.dispose();
    (this.mesh.geometry as THREE.BufferGeometry).dispose();
    (this.flash.material as THREE.Material).dispose();
    (this.flash.geometry as THREE.BufferGeometry).dispose();
  }
}
