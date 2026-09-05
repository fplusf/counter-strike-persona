import * as THREE from 'three';
import { resolveCollision } from './world';
import type { Target } from './weapon';

const EYE_STAND = 1.68;
const EYE_CROUCH = 1.02;
const ACCEL = 62;
const AIR_ACCEL = 9;
const FRICTION = 11;
const GRAVITY = 24;

export interface Input {
  forward: number; right: number;
  jump: boolean; crouch: boolean; sprint: boolean;
  fire: boolean; reload: boolean;
  slot: number | null;
}

export class Player implements Target {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  readonly radius = 0.36;
  height = EYE_STAND;
  hp = 100;
  maxHp = 100;
  alive = true;
  yaw = 0;
  pitch = 0;
  grounded = false;
  /** How much the last hit shoved the view, in radians. Decays each frame. */
  flinch = new THREE.Vector2();
  lastHurt = 99;
  private eye = EYE_STAND;

  constructor(private colliders: THREE.Box3[]) {}

  spawn(at: THREE.Vector3, yaw: number) {
    this.position.copy(at);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw; this.pitch = 0;
    this.hp = this.maxHp;
    this.alive = true;
    this.lastHurt = 99;
    this.flinch.set(0, 0);
  }

  hit(damage: number, from: THREE.Vector3) {
    if (!this.alive) return;
    this.hp -= damage;
    this.lastHurt = 0;
    const away = from.clone().sub(this.position);
    this.flinch.set(
      Math.atan2(away.x, away.z) * 0.012,
      -0.03 - damage * 0.001,
    );
    if (this.hp <= 0) { this.hp = 0; this.alive = false; }
  }

  look(dx: number, dy: number, sensitivity: number) {
    this.yaw -= dx * sensitivity;
    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - dy * sensitivity));
  }

  get forward(): THREE.Vector3 {
    return new THREE.Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch),
    );
  }

  get speed(): number { return Math.hypot(this.velocity.x, this.velocity.z); }

  update(dt: number, input: Input) {
    this.lastHurt += dt;
    this.flinch.multiplyScalar(Math.max(0, 1 - dt * 6));

    const crouching = input.crouch && this.grounded;
    const targetEye = crouching ? EYE_CROUCH : EYE_STAND;
    this.eye += (targetEye - this.eye) * Math.min(1, dt * 12);
    this.height = this.eye;

    const wish = new THREE.Vector3(
      Math.cos(this.yaw) * input.right - Math.sin(this.yaw) * input.forward,
      0,
      -Math.sin(this.yaw) * input.right - Math.cos(this.yaw) * input.forward,
    );
    if (wish.lengthSq() > 1) wish.normalize();

    const top = crouching ? 2.6 : input.sprint ? 8.2 : 5.9;
    const accel = this.grounded ? ACCEL : AIR_ACCEL;
    this.velocity.x += wish.x * accel * dt;
    this.velocity.z += wish.z * accel * dt;

    if (this.grounded) {
      const drag = Math.max(0, 1 - FRICTION * dt);
      if (wish.lengthSq() < 0.01) { this.velocity.x *= drag; this.velocity.z *= drag; }
    }
    const flat = Math.hypot(this.velocity.x, this.velocity.z);
    if (flat > top) { this.velocity.x *= top / flat; this.velocity.z *= top / flat; }

    if (input.jump && this.grounded) { this.velocity.y = 8.0; this.grounded = false; }
    this.velocity.y -= GRAVITY * dt;

    this.position.addScaledVector(this.velocity, dt);

    if (this.position.y - this.eye < 0) {
      this.position.y = this.eye;
      this.velocity.y = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }

    const before = this.position.y;
    const { grounded } = resolveCollision(this.position, this.radius, this.eye, this.colliders);
    if (grounded) {
      this.grounded = true;
      if (this.position.y > before) this.velocity.y = 0;
    }
    if (this.position.y < -8) {
      // Back to the middle of the page, but no free patch-up for falling off it.
      this.position.set(0, this.eye, 0);
      this.velocity.set(0, 0, 0);
    }
  }

  applyTo(camera: THREE.PerspectiveCamera) {
    camera.position.copy(this.position);
    camera.rotation.set(0, 0, 0);
    camera.rotateY(this.yaw + this.flinch.x);
    camera.rotateX(this.pitch + this.flinch.y);
  }
}

export function makeInput(): { state: Input; attach(el: HTMLElement): () => void } {
  const state: Input = {
    forward: 0, right: 0, jump: false, crouch: false, sprint: false,
    fire: false, reload: false, slot: null,
  };
  const held = new Set<string>();

  const sync = () => {
    state.forward = (held.has('KeyW') ? 1 : 0) - (held.has('KeyS') ? 1 : 0);
    state.right = (held.has('KeyD') ? 1 : 0) - (held.has('KeyA') ? 1 : 0);
    state.jump = held.has('Space');
    state.crouch = held.has('ControlLeft') || held.has('KeyC');
    state.sprint = held.has('ShiftLeft');
    state.reload = held.has('KeyR');
  };

  return {
    state,
    attach(el) {
      const down = (e: KeyboardEvent) => {
        held.add(e.code);
        if (/^Digit[1-5]$/.test(e.code)) state.slot = Number(e.code.slice(5)) - 1;
        if (e.code === 'Space') e.preventDefault();
        sync();
      };
      const up = (e: KeyboardEvent) => { held.delete(e.code); sync(); };
      const mdown = (e: MouseEvent) => { if (e.button === 0) state.fire = true; };
      const mup = (e: MouseEvent) => { if (e.button === 0) state.fire = false; };
      const blur = () => { held.clear(); state.fire = false; sync(); };

      window.addEventListener('keydown', down);
      window.addEventListener('keyup', up);
      el.addEventListener('mousedown', mdown);
      window.addEventListener('mouseup', mup);
      window.addEventListener('blur', blur);
      return () => {
        window.removeEventListener('keydown', down);
        window.removeEventListener('keyup', up);
        el.removeEventListener('mousedown', mdown);
        window.removeEventListener('mouseup', mup);
        window.removeEventListener('blur', blur);
      };
    },
  };
}
