import * as THREE from 'three';
import type { CharacterSpec, JointName, Vec2 } from '../types';
import { cutParts, type Bone, type Cut, type Mask } from '../studio/rig';
import { LAYER_PAPER } from '../ink/paperPass';

/**
 * A drawing becomes a marionette of paper scraps.
 *
 *   neck ──torso──> hip ──thigh──> knee ──shin──> foot
 *    │
 *    ├─ head
 *    └─ shoulder ──upper──> elbow ──fore──> hand
 *
 * Each scrap is one quad whose UVs are cut straight out of the source image
 * along the bone, so the rest pose is pixel-for-pixel the picture you drew.
 */

interface PartDef {
  name: string;
  parent: string | null;
  /** Bone start — also the joint the part rotates around. */
  from: JointName;
  to: JointName;
  z: number;
}

const PARTS: PartDef[] = [
  { name: 'torso', parent: null, from: 'neck', to: 'hip', z: 0 },
  { name: 'head', parent: null, from: 'neck', to: 'head', z: 0.012 },
  { name: 'armL', parent: null, from: 'shoulderL', to: 'elbowL', z: -0.05 },
  { name: 'foreL', parent: 'armL', from: 'elbowL', to: 'handL', z: -0.004 },
  { name: 'armR', parent: null, from: 'shoulderR', to: 'elbowR', z: 0.05 },
  { name: 'foreR', parent: 'armR', from: 'elbowR', to: 'handR', z: 0.004 },
  { name: 'thighL', parent: null, from: 'hip', to: 'kneeL', z: -0.02 },
  { name: 'shinL', parent: 'thighL', from: 'kneeL', to: 'footL', z: -0.004 },
  { name: 'thighR', parent: null, from: 'hip', to: 'kneeR', z: 0.02 },
  { name: 'shinR', parent: 'thighR', from: 'kneeR', to: 'footR', z: 0.004 },
];

/** When there is no mask to read, fall back to a plausible stick thickness. */
const FALLBACK: Cut = { tMin: -0.05, tMax: 1.12, left: 0.055, right: 0.055 };

export type Pose = 'idle' | 'run' | 'aim' | 'hurt' | 'dead';

export interface PaperDoll {
  root: THREE.Group;
  /** Where a held weapon or a muzzle flash should sit. */
  hand: THREE.Object3D;
  setPose(pose: Pose, t: number, speed: number): void;
  setTint(colour: THREE.Color, amount: number): void;
  dispose(): void;
}

function quadGeometry(
  a: Vec2, b: Vec2, cut: Cut,
  texW: number, texH: number, mpp: number,
): THREE.BufferGeometry {
  const ax = a.x * texW, ay = a.y * texH;
  const dx = b.x * texW - ax, dy = b.y * texH - ay;
  const len = Math.max(1e-3, Math.hypot(dx, dy));
  const px = -dy / len, py = dx / len;   // left of the bone, in image space
  const lw = cut.left * texW, rw = cut.right * texW;

  const startX = ax + dx * cut.tMin, startY = ay + dy * cut.tMin;
  const endX = ax + dx * cut.tMax, endY = ay + dy * cut.tMax;

  const corners: Vec2[] = [
    { x: startX + px * lw, y: startY + py * lw },
    { x: startX - px * rw, y: startY - py * rw },
    { x: endX + px * lw, y: endY + py * lw },
    { x: endX - px * rw, y: endY - py * rw },
  ];

  // The pivot is the bone's start joint, so rotation happens about the joint.
  const ox = ax, oy = ay;
  const pos = new Float32Array(12);
  const uvs = new Float32Array(8);
  corners.forEach((c, i) => {
    pos[i * 3 + 0] = (c.x - ox) * mpp;
    pos[i * 3 + 1] = -(c.y - oy) * mpp;   // image Y is down, world Y is up
    pos[i * 3 + 2] = 0;
    uvs[i * 2 + 0] = c.x / texW;
    uvs[i * 2 + 1] = 1 - c.y / texH;
  });

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setIndex([0, 2, 1, 1, 2, 3]);
  g.computeVertexNormals();
  return g;
}

export function buildPaperDoll(
  spec: CharacterSpec, texture: THREE.Texture, mask: Mask | null,
): PaperDoll {
  const { rig, width: texW, height: texH } = spec;
  const footY = Math.max(rig.footL.y, rig.footR.y);
  const mpp = spec.worldHeight / (footY * texH - Math.min(rig.head.y, 0) * texH || texH);

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    alphaTest: 0.35,
    side: THREE.DoubleSide,
    toneMapped: false,
  });

  const root = new THREE.Group();
  const chest = new THREE.Group();
  // Neck sits this far above the ground once the feet are planted.
  chest.position.y = (footY - rig.neck.y) * texH * mpp;
  root.add(chest);

  const pivots = new Map<string, THREE.Group>();
  const geometries: THREE.BufferGeometry[] = [];
  const bones: Bone[] = PARTS.map((p) => ({ name: p.name, a: rig[p.from], b: rig[p.to] }));
  const cuts = mask ? cutParts(mask, bones) : null;

  for (const def of PARTS) {
    const parent = def.parent ? pivots.get(def.parent)! : chest;
    const parentJoint = def.parent
      ? PARTS.find((p) => p.name === def.parent)!.from
      : 'neck' as JointName;

    const pivot = new THREE.Group();
    pivot.position.set(
      (rig[def.from].x - rig[parentJoint].x) * texW * mpp,
      -(rig[def.from].y - rig[parentJoint].y) * texH * mpp,
      def.z,
    );
    parent.add(pivot);
    pivots.set(def.name, pivot);

    const geo = quadGeometry(
      rig[def.from], rig[def.to], cuts?.[def.name] ?? FALLBACK, texW, texH, mpp,
    );
    geometries.push(geo);
    const mesh = new THREE.Mesh(geo, material);
    mesh.layers.set(LAYER_PAPER);
    pivot.add(mesh);
  }

  const hand = new THREE.Object3D();
  const foreR = pivots.get('foreR')!;
  hand.position.set(
    (rig.handR.x - rig.elbowR.x) * texW * mpp,
    -(rig.handR.y - rig.elbowR.y) * texH * mpp,
    0.02,
  );
  foreR.add(hand);

  const rest = new Map<string, number>();
  pivots.forEach((p, k) => rest.set(k, p.rotation.z));
  const swing = (name: string, radians: number) => {
    const p = pivots.get(name)!;
    p.rotation.z = rest.get(name)! + radians;
  };

  let boilSeed = 0;
  let boilStep = -1;

  function setPose(pose: Pose, t: number, speed: number) {
    // Line boil: re-jitter every joint 8 times a second so the figure never
    // sits perfectly still, the way a flipbook never traces itself twice.
    const step = Math.floor(t * 8);
    if (step !== boilStep) { boilStep = step; boilSeed = Math.random(); }
    const boil = (i: number) => (Math.sin(boilSeed * 97.3 + i * 12.9898) * 0.5) * 0.035;

    if (pose === 'dead') {
      root.rotation.z = Math.min(Math.PI / 2, root.rotation.z + 0.16);
      root.position.y = Math.max(-0.3, root.position.y - 0.02);
      swing('armL', 1.1); swing('armR', -1.1);
      swing('thighL', 0.7); swing('thighR', -0.5);
      return;
    }

    const gait = t * (4.5 + speed * 1.6);
    const walking = pose === 'run';
    const stride = walking ? Math.min(1, 0.35 + speed * 0.5) : 0;
    const bob = walking ? Math.abs(Math.sin(gait)) * 0.045 * stride : Math.sin(t * 1.9) * 0.008;

    root.position.y = bob;
    chest.rotation.z = boil(0) + (walking ? Math.sin(gait * 2) * 0.03 * stride : 0);

    swing('thighL', Math.sin(gait) * 0.85 * stride + boil(1));
    swing('shinL', Math.max(0, -Math.sin(gait + 0.9)) * 0.9 * stride);
    swing('thighR', -Math.sin(gait) * 0.85 * stride + boil(2));
    swing('shinR', Math.max(0, Math.sin(gait + 0.9)) * 0.9 * stride);

    if (pose === 'aim') {
      // Arms come up to a firing stance, not out to a scarecrow's.
      swing('armR', -0.75 + boil(3) * 0.4);
      swing('foreR', 0.55);
      swing('armL', -0.5 + boil(4) * 0.4);
      swing('foreL', 0.75);
    } else if (pose === 'hurt') {
      swing('armL', -1.9 + boil(5)); swing('armR', 1.9 + boil(6));
      chest.rotation.z += 0.22;
    } else {
      swing('armL', -Math.sin(gait) * 0.6 * stride + boil(7));
      swing('foreL', 0.12 + Math.sin(t * 1.4) * 0.05);
      swing('armR', Math.sin(gait) * 0.6 * stride + boil(8));
      swing('foreR', 0.12 + Math.cos(t * 1.3) * 0.05);
    }
  }

  const baseColour = material.color.clone();
  function setTint(colour: THREE.Color, amount: number) {
    material.color.copy(baseColour).lerp(colour, amount);
  }

  return {
    root, hand, setPose, setTint,
    dispose() {
      geometries.forEach((g) => g.dispose());
      material.dispose();
    },
  };
}
