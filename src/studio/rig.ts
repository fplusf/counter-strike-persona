import type { JointName, Rig, Vec2 } from '../types';

export const JOINT_ORDER: JointName[] = [
  'head', 'neck', 'hip',
  'shoulderL', 'elbowL', 'handL',
  'shoulderR', 'elbowR', 'handR',
  'kneeL', 'footL', 'kneeR', 'footR',
];

export const JOINT_LABEL: Record<JointName, string> = {
  head: 'head', neck: 'neck', hip: 'hips',
  shoulderL: 'L shoulder', elbowL: 'L elbow', handL: 'L hand',
  shoulderR: 'R shoulder', elbowR: 'R elbow', handR: 'R hand',
  kneeL: 'L knee', footL: 'L foot', kneeR: 'R knee', footR: 'R foot',
};

/** Proportional fallback — a Vitruvian stick figure over the bounding box. */
export const DEFAULT_RIG: Rig = {
  head: { x: 0.50, y: 0.09 },
  neck: { x: 0.50, y: 0.20 },
  hip: { x: 0.50, y: 0.52 },
  shoulderL: { x: 0.38, y: 0.23 }, elbowL: { x: 0.29, y: 0.37 }, handL: { x: 0.24, y: 0.51 },
  shoulderR: { x: 0.62, y: 0.23 }, elbowR: { x: 0.71, y: 0.37 }, handR: { x: 0.76, y: 0.51 },
  kneeL: { x: 0.43, y: 0.75 }, footL: { x: 0.41, y: 0.98 },
  kneeR: { x: 0.57, y: 0.75 }, footR: { x: 0.59, y: 0.98 },
};

export interface Mask { data: Uint8Array; w: number; h: number; }

export function maskOf(canvas: HTMLCanvasElement): Mask {
  const w = canvas.width, h = canvas.height;
  const d = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  const m = new Uint8Array(w * h);
  for (let p = 0; p < m.length; p++) m[p] = d[p * 4 + 3] > 40 ? 1 : 0;
  return { data: m, w, h };
}

/**
 * Reads the silhouette and moves the default pins onto it.
 *
 *   row extent          runs per row
 *   ▕████▏  head          1
 *   ▕▌▏     neck          1     <- narrowest row under the head
 *   ▕██████▏ shoulders    1     <- widest row under the neck
 *   ▕▌   ▐▏  arms out     3
 *   ▕▌▏     waist         1
 *   ▕▌  ▐▏  legs          2     <- crotch is where 1 becomes 2
 *
 * Extent, not pixel count: a drawn head is a hollow ring, so it has barely
 * more ink in a row than the single line of a neck, but it is fifteen times
 * as wide. Any pin the player disagrees with, they drag; this only has to be
 * close enough that dragging is a nudge.
 */
export function guessRig(mask: Mask): Rig {
  const { data, w, h } = mask;
  const lo = new Int32Array(h).fill(-1);
  const hi = new Int32Array(h).fill(-1);
  const runs = new Int32Array(h);
  let top = -1, bottom = -1;

  for (let y = 0; y < h; y++) {
    let inRun = false, count = 0;
    for (let x = 0; x < w; x++) {
      const ink = data[y * w + x] === 1;
      if (ink) {
        if (lo[y] < 0) lo[y] = x;
        hi[y] = x;
        if (!inRun) { count++; inRun = true; }
      } else if (inRun && x - hi[y] > 2) {
        inRun = false;
      }
    }
    runs[y] = count;
    if (lo[y] >= 0) { if (top < 0) top = y; bottom = y; }
  }
  if (top < 0) return structuredClone(DEFAULT_RIG);

  const H = bottom - top;
  const extent = (y: number) => (lo[y] < 0 ? 0 : hi[y] - lo[y] + 1);
  const mid = (y: number) => (lo[y] < 0 ? w / 2 : (lo[y] + hi[y]) / 2);
  const norm = (x: number, y: number): Vec2 => ({ x: x / w, y: y / h });
  const clampRow = (y: number) => Math.max(top, Math.min(bottom, Math.round(y)));

  // Neck: the narrowest row in the upper third, below the head.
  let neckY = clampRow(top + H * 0.2), narrow = Infinity;
  for (let y = clampRow(top + H * 0.08); y <= clampRow(top + H * 0.38); y++) {
    const e = extent(y);
    if (e > 0 && e < narrow) { narrow = e; neckY = y; }
  }

  // Shoulders: the first row under the neck where the body actually broadens,
  // not the widest row — arms spread as they fall, so "widest" lands at the
  // wrists. Falls back to the widest row if the figure never broadens sharply.
  const headExtent = (() => {
    let e = 0;
    for (let y = top; y < neckY; y++) e = Math.max(e, extent(y));
    return e;
  })();
  const broadens = Math.max(extent(neckY) * 2.5, headExtent * 0.85);
  let shoulderY = -1, widest = -1, widestY = neckY;
  for (let y = neckY + 1; y <= clampRow(neckY + H * 0.25); y++) {
    if (extent(y) > widest) { widest = extent(y); widestY = y; }
    if (shoulderY < 0 && extent(y) >= broadens) shoulderY = y;
  }
  if (shoulderY < 0) shoulderY = widestY;

  // Crotch: reading up from the feet, where two legs become one body.
  let hipY = -1;
  for (let y = clampRow(bottom - H * 0.05); y > clampRow(top + H * 0.32); y--) {
    if (runs[y] === 1 && runs[Math.min(bottom, y + 2)] >= 2 && runs[Math.min(bottom, y + 5)] >= 2) {
      hipY = y;
      break;
    }
  }
  if (hipY < 0) {
    // No clear split — fall back to the narrowest row across the middle.
    hipY = clampRow(top + H * 0.55);
    let waist = Infinity;
    for (let y = clampRow(top + H * 0.42); y <= clampRow(top + H * 0.68); y++) {
      const e = extent(y);
      if (e > 0 && e < waist) { waist = e; hipY = y; }
    }
  }

  // Hands: the ink that reaches furthest sideways between shoulders and hips.
  let lx = w, lyAt = hipY, rx = -1, ryAt = hipY;
  for (let y = shoulderY; y <= Math.min(bottom, hipY + H * 0.06); y++) {
    if (lo[y] < 0) continue;
    if (lo[y] < lx) { lx = lo[y]; lyAt = y; }
    if (hi[y] > rx) { rx = hi[y]; ryAt = y; }
  }
  if (rx < 0) { lx = lo[shoulderY]; rx = hi[shoulderY]; }

  // Feet: the bottom band, split down the middle of the body.
  const band = Math.max(1, Math.round(H * 0.05));
  const centreX = mid(hipY);
  let flx = 0, fln = 0, frx = 0, frn = 0;
  for (let y = bottom - band; y <= bottom; y++) {
    for (let x = 0; x < w; x++) {
      if (!data[y * w + x]) continue;
      if (x < centreX) { flx += x; fln++; } else { frx += x; frn++; }
    }
  }
  const footLx = fln ? flx / fln : centreX - (rx - lx) * 0.1;
  const footRx = frn ? frx / frn : centreX + (rx - lx) * 0.1;

  const shoulderInset = (hi[shoulderY] - lo[shoulderY]) * 0.16;
  const shoulderL = norm(lo[shoulderY] + shoulderInset, shoulderY);
  const shoulderR = norm(hi[shoulderY] - shoulderInset, shoulderY);
  const handL = norm(lx, lyAt);
  const handR = norm(rx, ryAt);
  const hip = norm(centreX, hipY);
  const footL = norm(footLx, bottom);
  const footR = norm(footRx, bottom);

  // Joints bow slightly outward so limbs bend the way a body bends.
  const bend = (a: Vec2, b: Vec2, out: number): Vec2 =>
    ({ x: (a.x + b.x) / 2 + out, y: (a.y + b.y) / 2 });

  // Head centre of mass above the neck, so a big head is not pinned at its rim.
  let hx = 0, hn = 0;
  for (let y = top; y < neckY; y++) { hx += mid(y) * extent(y); hn += extent(y); }

  return {
    head: norm(hn ? hx / hn : mid(top), top + (neckY - top) * 0.5),
    neck: norm(mid(neckY), neckY),
    hip,
    shoulderL, elbowL: bend(shoulderL, handL, -0.012), handL,
    shoulderR, elbowR: bend(shoulderR, handR, 0.012), handR,
    kneeL: bend(hip, footL, -0.008), footL,
    kneeR: bend(hip, footR, 0.008), footR,
  };
}

export interface Bone { name: string; a: Vec2; b: Vec2; }

/**
 * How much of the drawing belongs to each bone, in that bone's own frame.
 * `t` runs along the bone (0 = start joint, 1 = end joint) and can overshoot;
 * `left`/`right` are perpendicular reach, in normalised x units.
 */
export interface Cut { tMin: number; tMax: number; left: number; right: number; }

/**
 * Every inked pixel is handed to the bone it lies closest to, and each bone
 * then reports the box that holds its share.
 *
 *      ○ head           A hollow head defeats a ray-march outward from the
 *     ╱│╲               bone — there is nothing to hit until the far rim.
 *      │      ──▶       Nearest-bone assignment does not care: the rim
 *     ╱ ╲               pixels are closest to the head bone, so the head
 *                       box grows to hold them. Each pixel lands in exactly
 *                       one box, so no scrap of the drawing is used twice.
 */
export function cutParts(mask: Mask, bones: Bone[]): Record<string, Cut> {
  const { data, w, h } = mask;
  const n = bones.length;
  const ax = new Float64Array(n), ay = new Float64Array(n);
  const dx = new Float64Array(n), dy = new Float64Array(n);
  const len2 = new Float64Array(n), len = new Float64Array(n);
  const cuts: Cut[] = [];

  for (let i = 0; i < n; i++) {
    ax[i] = bones[i].a.x * w; ay[i] = bones[i].a.y * h;
    dx[i] = bones[i].b.x * w - ax[i]; dy[i] = bones[i].b.y * h - ay[i];
    len2[i] = dx[i] * dx[i] + dy[i] * dy[i] || 1e-6;
    len[i] = Math.sqrt(len2[i]);
    cuts.push({ tMin: 0, tMax: 1, left: 0, right: 0 });
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!data[y * w + x]) continue;
      let best = -1, bestD = Infinity, bestT = 0;
      for (let i = 0; i < n; i++) {
        const px = x - ax[i], py = y - ay[i];
        const raw = (px * dx[i] + py * dy[i]) / len2[i];
        const t = raw < 0 ? 0 : raw > 1 ? 1 : raw;
        const cx = px - dx[i] * t, cy = py - dy[i] * t;
        const d = cx * cx + cy * cy;
        if (d < bestD) { bestD = d; best = i; bestT = raw; }
      }
      const cut = cuts[best];
      // Clamp the overshoot so one stray speck cannot stretch a limb.
      const t = Math.max(-0.8, Math.min(1.9, bestT));
      if (t < cut.tMin) cut.tMin = t;
      if (t > cut.tMax) cut.tMax = t;
      const side = ((x - ax[best]) * -dy[best] + (y - ay[best]) * dx[best]) / len[best];
      if (side > cut.left) cut.left = side;
      else if (-side > cut.right) cut.right = -side;
    }
  }

  const out: Record<string, Cut> = {};
  const pad = 2.5;
  const floor = 2;
  bones.forEach((b, i) => {
    const c = cuts[i];
    out[b.name] = {
      tMin: c.tMin - pad / len[i],
      tMax: c.tMax + pad / len[i],
      left: (Math.max(c.left, floor) + pad) / w,
      right: (Math.max(c.right, floor) + pad) / w,
    };
  });
  return out;
}
