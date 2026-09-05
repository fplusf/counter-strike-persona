import * as THREE from 'three';
import { LAYER_PAPER } from '../ink/paperPass';

export interface Arena {
  group: THREE.Group;
  colliders: THREE.Box3[];
  playerSpawn: THREE.Vector3;
  enemySpawns: THREE.Vector3[];
  bounds: THREE.Box3;
}

type Block = [x: number, y: number, z: number, w: number, h: number, d: number, tone?: number];

/**
 * A defuse-map silhouette squeezed into one arena: long, a raised catwalk down
 * one side, crates for peeking, and two mouths that keep enemies flowing in.
 *
 *        ┌──────── catwalk ────────┐
 *   A ───┤   ▢    ▢        ▢       ├─── B
 *        └──── mid ──── crates ────┘
 */
const BLOCKS: Block[] = [
  // Perimeter
  [0, 4.5, -26, 56, 9, 1.4, 0.62], [0, 4.5, 26, 56, 9, 1.4, 0.62],
  [-28, 4.5, 0, 1.4, 9, 52, 0.58], [28, 4.5, 0, 1.4, 9, 52, 0.58],
  // Long building, west
  [-16, 2.4, -13, 16, 4.8, 12, 0.7], [-16, 5.2, -13, 17, 0.6, 13, 0.5],
  // Catwalk and its ramp
  [12, 1.8, -14, 22, 0.7, 7, 0.66], [12, 0.9, -10.2, 22, 0.5, 0.6, 0.6],
  [1.5, 0.9, -14, 4, 1.8, 7, 0.72],
  // Bombsite platform, east
  [17, 0.55, 12, 16, 1.1, 14, 0.68],
  [22, 2.6, 6.4, 6, 5.2, 1.2, 0.6],
  // Crates
  [-3, 1, 4, 2.6, 2, 2.6, 0.82], [-3, 3, 4, 2.1, 2, 2.1, 0.86],
  [4, 1.1, -2, 2.8, 2.2, 2.8, 0.8], [-9, 1.1, 9, 3, 2.2, 3, 0.78],
  [9, 1, 18, 2.6, 2, 2.6, 0.82], [-19, 1.2, 3, 3.2, 2.4, 3.2, 0.76],
  [20, 1.4, -3, 3.4, 2.8, 3.4, 0.74],
  // Half-walls to crouch behind
  [-8, 0.7, -4, 7, 1.4, 0.8, 0.7], [7, 0.7, 9, 8, 1.4, 0.8, 0.7],
  [0, 0.7, 20, 9, 1.4, 0.8, 0.7],
];

function doodleSky(): THREE.Texture {
  const w = 2048, h = 512;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = '#2b3a86';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';

  const sunX = w * 0.34, sunY = h * 0.36, sunR = 46;
  ctx.beginPath(); ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2); ctx.stroke();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(sunX + Math.cos(a) * (sunR + 12), sunY + Math.sin(a) * (sunR + 12));
    ctx.lineTo(sunX + Math.cos(a) * (sunR + 34), sunY + Math.sin(a) * (sunR + 34));
    ctx.stroke();
  }
  const puff = (x: number, y: number, s: number) => {
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      ctx.arc(x + i * s * 0.7 - s, y - Math.sin(i) * s * 0.25, s * (0.5 + (i % 2) * 0.28), Math.PI, 0);
    }
    ctx.stroke();
  };
  [[0.1, 0.3, 26], [0.55, 0.24, 34], [0.72, 0.44, 22], [0.88, 0.3, 30], [0.2, 0.55, 20]]
    .forEach(([fx, fy, s]) => puff(w * fx, h * fy, s));

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildArena(): Arena {
  const group = new THREE.Group();
  const colliders: THREE.Box3[] = [];

  const ground = new THREE.Mesh(
    new THREE.BoxGeometry(60, 0.6, 56),
    new THREE.MeshLambertMaterial({ color: '#f2eee0' }),
  );
  ground.position.y = -0.3;
  group.add(ground);

  for (const [x, y, z, w, h, d, tone = 0.7] of BLOCKS) {
    const shade = Math.round(255 * tone);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshLambertMaterial({
        color: new THREE.Color(`rgb(${shade},${shade},${Math.min(255, shade + 16)})`),
      }),
    );
    mesh.position.set(x, y, z);
    group.add(mesh);
    colliders.push(new THREE.Box3(
      new THREE.Vector3(x - w / 2, y - h / 2, z - d / 2),
      new THREE.Vector3(x + w / 2, y + h / 2, z + d / 2),
    ));
  }

  const sky = new THREE.Mesh(
    new THREE.PlaneGeometry(300, 75),
    new THREE.MeshBasicMaterial({ map: doodleSky(), transparent: true, depthWrite: false, toneMapped: false }),
  );
  sky.position.set(0, 26, -95);
  sky.layers.set(LAYER_PAPER);
  group.add(sky);

  const sun = new THREE.DirectionalLight(0xffffff, 1.05);
  sun.position.set(-14, 24, 10);
  group.add(sun);
  // Generous fill: an unlit face should still be a hatched grey, not a hole.
  group.add(new THREE.HemisphereLight(0xffffff, 0xd8dcf0, 2.1));

  return {
    group,
    colliders,
    playerSpawn: new THREE.Vector3(-20, 1.7, 16),
    enemySpawns: [
      new THREE.Vector3(20, 1.2, -20), new THREE.Vector3(-20, 1.2, -20),
      new THREE.Vector3(24, 1.7, 14), new THREE.Vector3(-4, 1.2, -22),
      new THREE.Vector3(14, 2.6, -14), new THREE.Vector3(-24, 1.2, 8),
    ],
    bounds: new THREE.Box3(new THREE.Vector3(-27, -2, -25), new THREE.Vector3(27, 12, 25)),
  };
}

/** Push an upright capsule out of every box it overlaps. */
export function resolveCollision(
  pos: THREE.Vector3, radius: number, height: number, colliders: THREE.Box3[],
): { grounded: boolean } {
  let grounded = false;
  const feet = pos.y - height;
  for (const box of colliders) {
    if (pos.x + radius < box.min.x || pos.x - radius > box.max.x) continue;
    if (pos.z + radius < box.min.z || pos.z - radius > box.max.z) continue;
    if (feet > box.max.y - 0.001 || pos.y < box.min.y) continue;

    const overlapX = Math.min(pos.x + radius - box.min.x, box.max.x - (pos.x - radius));
    const overlapZ = Math.min(pos.z + radius - box.min.z, box.max.z - (pos.z - radius));
    const overlapY = box.max.y - feet;

    // Step onto low ledges instead of jamming against them.
    if (overlapY <= 0.62 && overlapY <= Math.min(overlapX, overlapZ)) {
      pos.y = box.max.y + height;
      grounded = true;
      continue;
    }
    if (overlapX < overlapZ) {
      pos.x += pos.x < (box.min.x + box.max.x) / 2 ? -overlapX : overlapX;
    } else {
      pos.z += pos.z < (box.min.z + box.max.z) / 2 ? -overlapZ : overlapZ;
    }
  }
  return { grounded };
}

export interface BoxHit { point: THREE.Vector3; normal: THREE.Vector3; distance: number; }

/**
 * Nearest box a segment runs into, with the face normal it struck.
 *
 *   ──────▶│        A ricochet has to reflect about the surface it hit, not
 *      ↗   │        about whichever axis the bullet happened to be moving
 *          │        along fastest — those are different whenever a shot
 *                   comes in at a shallow angle, which is most of them.
 */
export function raycastBoxes(
  a: THREE.Vector3, b: THREE.Vector3, colliders: THREE.Box3[],
): BoxHit | null {
  const dir = b.clone().sub(a);
  const dist = dir.length();
  if (dist < 1e-5) return null;
  dir.divideScalar(dist);
  const ray = new THREE.Ray(a, dir);
  const point = new THREE.Vector3();

  let best: BoxHit | null = null;
  for (const box of colliders) {
    if (!ray.intersectBox(box, point)) continue;
    const d = point.distanceTo(a);
    if (d > dist || (best && d >= best.distance)) continue;

    // The face the hit sits on is the one it is flush with.
    const normal = new THREE.Vector3();
    const eps = 1e-3;
    if (Math.abs(point.x - box.min.x) < eps) normal.set(-1, 0, 0);
    else if (Math.abs(point.x - box.max.x) < eps) normal.set(1, 0, 0);
    else if (Math.abs(point.y - box.min.y) < eps) normal.set(0, -1, 0);
    else if (Math.abs(point.y - box.max.y) < eps) normal.set(0, 1, 0);
    else if (Math.abs(point.z - box.min.z) < eps) normal.set(0, 0, -1);
    else normal.set(0, 0, 1);

    best = { point: point.clone(), normal, distance: d };
  }
  return best;
}

/** Cheap line-of-sight test against the block list. */
export function segmentBlocked(
  a: THREE.Vector3, b: THREE.Vector3, colliders: THREE.Box3[], skipGround = true,
): boolean {
  const dir = b.clone().sub(a);
  const dist = dir.length();
  if (dist < 1e-4) return false;
  dir.divideScalar(dist);
  const ray = new THREE.Ray(a, dir);
  const hit = new THREE.Vector3();
  for (const box of colliders) {
    if (skipGround && box.max.y < 0.05) continue;
    if (ray.intersectBox(box, hit) && hit.distanceTo(a) < dist - 0.05) return true;
  }
  return false;
}
