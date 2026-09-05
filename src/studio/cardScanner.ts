import type { FirePattern, WeaponPips } from '../types';
import { flattenLuminance } from './imagePipeline';
import { PIP_MAX } from '../types';

/**
 * The Weapon Card. Draw the gun in the box, shade the pips, tick a pattern,
 * photograph it. The scanner reads it the way an exam board reads a bubble
 * sheet — four printed corner marks give it a frame of reference, everything
 * else is sampled at a known address inside that frame.
 *
 *   ■ ─────────────────────── ■
 *   │      draw the gun       │
 *   │  DAMAGE  ▣▣▣▣▢▢▢▢       │
 *   │  RATE    ▣▣▣▢▢▢▢▢       │
 *   │  ○ straight ● spread …  │
 *   ■ ─────────────────────── ■
 *
 * Because the layout lives here and the printable sheet is generated from the
 * same numbers, the print and the reader can never drift apart.
 */
export const CARD = {
  w: 1000,
  h: 1414,
  markInset: 62,
  markSize: 46,
  draw: { x: 70, y: 150, w: 860, h: 610 },
  rows: ['damage', 'fireRate', 'accuracy', 'ammo', 'reload', 'count'] as const,
  rowLabel: {
    damage: 'DAMAGE', fireRate: 'FIRE RATE', accuracy: 'ACCURACY',
    ammo: 'MAGAZINE', reload: 'RELOAD', count: 'PROJECTILES',
  } as Record<string, string>,
  rowY: 838,
  rowStep: 52,
  pipX: 430,
  pipStep: 62,
  pipSize: 36,
  patterns: ['straight', 'spread', 'arc', 'bounce', 'homing', 'beam'] as FirePattern[],
  patternY: 1214,
  patternX: 96,
  patternStep: 146,
  patternSize: 40,
} as const;

export interface ScanResult {
  pips: WeaponPips;
  pattern: FirePattern;
  /** The drawing area, de-skewed and cropped, ready for the matte pipeline. */
  artwork: HTMLCanvasElement;
  /** False when no corner marks were found and the whole photo was used. */
  cardDetected: boolean;
}

// ---------------------------------------------------------------- homography

type Mat9 = number[];

/** Solve for the 3x3 that maps the four source points onto the four dest points. */
export function homography(src: [number, number][], dst: [number, number][]): Mat9 | null {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const n = 8;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r;
    if (Math.abs(A[pivot][col]) < 1e-9) return null;
    [A[col], A[pivot]] = [A[pivot], A[col]];
    [b[col], b[pivot]] = [b[pivot], b[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = A[r][col] / A[col][col];
      for (let c = col; c < n; c++) A[r][c] -= f * A[col][c];
      b[r] -= f * b[col];
    }
  }
  const h = b.map((v, i) => v / A[i][i]);
  return [...h, 1];
}

export function apply(h: Mat9, x: number, y: number): [number, number] {
  const d = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / d, (h[3] * x + h[4] * y + h[5]) / d];
}

// ------------------------------------------------------------ mark detection

interface Gray { g: Float32Array; w: number; h: number; }

function toGray(canvas: HTMLCanvasElement): Gray {
  const { width: w, height: h } = canvas;
  const d = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  const g = new Float32Array(w * h);
  for (let p = 0, i = 0; p < g.length; p++, i += 4) {
    g[p] = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
  }
  return { g, w, h };
}

/** Otsu's method: the threshold that best splits the histogram in two. */
function otsu(values: Float32Array | number[]): number {
  const bins = new Array(64).fill(0);
  for (const v of values) bins[Math.min(63, Math.max(0, Math.round(v * 63)))]++;
  const total = values.length;
  let sum = 0;
  bins.forEach((c, i) => (sum += (i / 63) * c));
  let sumB = 0, wB = 0, best = 0.5, bestVar = -1;
  for (let i = 0; i < 64; i++) {
    wB += bins[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += (i / 63) * bins[i];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVar) { bestVar = between; best = i / 63; }
  }
  return best;
}

interface Blob { cx: number; cy: number; area: number; w: number; h: number; }

function blobs(dark: Uint8Array, w: number, h: number, minArea: number, maxArea: number): Blob[] {
  const seen = new Uint8Array(w * h);
  const out: Blob[] = [];
  const stack: number[] = [];
  for (let start = 0; start < dark.length; start++) {
    if (!dark[start] || seen[start]) continue;
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    let area = 0, sx = 0, sy = 0, x0 = w, x1 = 0, y0 = h, y1 = 0;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w, y = (p / w) | 0;
      area++; sx += x; sy += y;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (area > maxArea) break;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (dark[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
      }
    }
    if (area >= minArea && area <= maxArea) {
      out.push({ cx: sx / area, cy: sy / area, area, w: x1 - x0 + 1, h: y1 - y0 + 1 });
    }
  }
  return out;
}

/** The four registration squares: solid, roughly square, one nearest each corner. */
function findMarks(gray: Gray): [number, number][] | null {
  const { g, w, h } = gray;
  const thr = otsu(g) * 0.85;
  const dark = new Uint8Array(w * h);
  for (let p = 0; p < g.length; p++) dark[p] = g[p] < thr ? 1 : 0;

  const area = w * h;
  const found = blobs(dark, w, h, area * 0.00012, area * 0.006)
    .filter((b) => {
      const ratio = b.w / Math.max(1, b.h);
      const fill = b.area / Math.max(1, b.w * b.h);
      return ratio > 0.62 && ratio < 1.6 && fill > 0.62;
    });
  if (found.length < 4) return null;

  const corners: [number, number][] = [[0, 0], [w, 0], [0, h], [w, h]];
  const picked: Blob[] = [];
  for (const [cx, cy] of corners) {
    let best: Blob | null = null, bestD = Infinity;
    for (const b of found) {
      if (picked.includes(b)) continue;
      const d = Math.hypot(b.cx - cx, b.cy - cy);
      if (d < bestD) { bestD = d; best = b; }
    }
    // A mark more than a third of the page from its corner is not a mark.
    if (!best || bestD > Math.hypot(w, h) * 0.36) return null;
    picked.push(best);
  }
  return picked.map((b) => [b.cx, b.cy] as [number, number]);
}

// ------------------------------------------------------------------ sampling

/** Mean brightness of a small patch of the card, addressed in card space. */
function patch(gray: Gray, h: Mat9, x: number, y: number, half: number): number {
  const step = Math.max(1, half / 4);
  let sum = 0, n = 0;
  for (let dy = -half; dy <= half; dy += step) {
    for (let dx = -half; dx <= half; dx += step) {
      const [sx, sy] = apply(h, x + dx, y + dy);
      const ix = Math.round(sx), iy = Math.round(sy);
      if (ix < 0 || iy < 0 || ix >= gray.w || iy >= gray.h) continue;
      sum += gray.g[iy * gray.w + ix];
      n++;
    }
  }
  return n ? sum / n : 1;
}

/**
 * How much darker a box is than the paper immediately around it.
 *
 *      ·  ·  ·      The eight dots sit in the printed gutters, which are
 *      ·  ▣  ·      always blank. The lightest of them is what paper looks
 *      ·  ·  ·      like *here*, under whatever light fell on this corner
 *                   of the page — so the comparison survives a shadow, a
 * warm bulb, or a phone that decided to expose for the desk.
 *
 * The box interior is read at a 30% inset so the printed outline is never
 * mistaken for shading.
 */
function contrast(
  gray: Gray, h: Mat9, x: number, y: number, size: number, gapX: number, gapY: number,
): number {
  const inner = patch(gray, h, x, y, size * 0.30);
  const probe = size * 0.18;
  let paper = 0;
  for (const [ox, oy] of [
    [-gapX, 0], [gapX, 0], [0, -gapY], [0, gapY],
    [-gapX, -gapY], [gapX, -gapY], [-gapX, gapY], [gapX, gapY],
  ]) {
    paper = Math.max(paper, patch(gray, h, x + ox, y + oy, probe));
  }
  return Math.max(0, paper - inner);
}

function warpRegion(
  source: HTMLCanvasElement, h: Mat9,
  rx: number, ry: number, rw: number, rh: number, scale = 1,
): HTMLCanvasElement {
  const ow = Math.round(rw * scale), oh = Math.round(rh * scale);
  const out = document.createElement('canvas');
  out.width = ow; out.height = oh;
  const sctx = source.getContext('2d', { willReadFrequently: true })!;
  const src = sctx.getImageData(0, 0, source.width, source.height);
  const dst = new ImageData(ow, oh);

  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      const [sx, sy] = apply(h, rx + (x / scale), ry + (y / scale));
      const ix = Math.round(sx), iy = Math.round(sy);
      const di = (y * ow + x) * 4;
      if (ix < 0 || iy < 0 || ix >= source.width || iy >= source.height) {
        dst.data[di] = dst.data[di + 1] = dst.data[di + 2] = 255;
        dst.data[di + 3] = 255;
        continue;
      }
      const si = (iy * source.width + ix) * 4;
      dst.data[di] = src.data[si];
      dst.data[di + 1] = src.data[si + 1];
      dst.data[di + 2] = src.data[si + 2];
      dst.data[di + 3] = 255;
    }
  }
  out.getContext('2d')!.putImageData(dst, 0, 0);
  return out;
}

export function scanCard(source: HTMLCanvasElement): ScanResult {
  const gray = toGray(source);
  const marks = findMarks(flattenLuminance(source));

  const fallback = (): ScanResult => ({
    pips: { damage: 4, fireRate: 4, accuracy: 4, ammo: 4, reload: 4, count: 1 },
    pattern: 'straight',
    artwork: source,
    cardDetected: false,
  });

  if (!marks) return fallback();

  const i = CARD.markInset;
  const canonical: [number, number][] = [
    [i, i], [CARD.w - i, i], [i, CARD.h - i], [CARD.w - i, CARD.h - i],
  ];
  // Canonical -> photo, so every printed feature can be looked up directly.
  const h = homography(canonical, marks);
  if (!h) return fallback();

  const pipGapX = CARD.pipStep / 2;
  const pipGapY = CARD.rowStep / 2;
  const readings: number[] = [];
  const grid: number[][] = [];
  CARD.rows.forEach((_, r) => {
    const row: number[] = [];
    for (let p = 0; p < PIP_MAX; p++) {
      const v = contrast(
        gray, h,
        CARD.pipX + p * CARD.pipStep + CARD.pipSize / 2,
        CARD.rowY + r * CARD.rowStep + CARD.pipSize / 2,
        CARD.pipSize, pipGapX, pipGapY,
      );
      row.push(v);
      readings.push(v);
    }
    grid.push(row);
  });

  const patternReads = CARD.patterns.map((_, k) => contrast(
    gray, h,
    CARD.patternX + k * CARD.patternStep + CARD.patternSize / 2,
    CARD.patternY + CARD.patternSize / 2,
    CARD.patternSize, CARD.patternStep / 2, CARD.patternSize * 0.9,
  ));

  // Otsu picks the split where the sheet is genuinely mixed; the floor stops a
  // blank sheet from having its noise split into "shaded" and "not".
  const cut = Math.max(0.16, Math.min(0.5, otsu([...readings, ...patternReads])));
  const shaded = (v: number) => v > cut;

  const pips = {} as WeaponPips;
  CARD.rows.forEach((name, r) => {
    // Read left to right and stop at the first gap — a pip bar is a bar.
    let count = 0;
    for (let p = 0; p < PIP_MAX; p++) {
      if (!shaded(grid[r][p])) break;
      count++;
    }
    if (count === 0) count = grid[r].filter(shaded).length;
    pips[name] = count;
  });

  let pattern: FirePattern = 'straight';
  let strongest = cut;
  patternReads.forEach((v, k) => { if (v > strongest) { strongest = v; pattern = CARD.patterns[k]; } });

  const artwork = warpRegion(source, h, CARD.draw.x, CARD.draw.y, CARD.draw.w, CARD.draw.h, 1.1);
  return { pips, pattern, artwork, cardDetected: true };
}

// ------------------------------------------------------------ printable card

export function buildCardSvg(): string {
  const { w, h, markInset: mi, markSize: ms } = CARD;
  const parts: string[] = [];
  const ink = '#101a4a';

  parts.push(`<rect width="${w}" height="${h}" fill="#fffdf5"/>`);
  for (const [x, y] of [[mi, mi], [w - mi, mi], [mi, h - mi], [w - mi, h - mi]]) {
    parts.push(`<rect x="${x - ms / 2}" y="${y - ms / 2}" width="${ms}" height="${ms}" fill="${ink}"/>`);
  }

  parts.push(`<text x="${w / 2}" y="112" text-anchor="middle" font-size="46" font-family="Georgia,serif" fill="${ink}">W E A P O N   C A R D</text>`);
  const d = CARD.draw;
  parts.push(`<rect x="${d.x}" y="${d.y}" width="${d.w}" height="${d.h}" fill="none" stroke="${ink}" stroke-width="3" stroke-dasharray="10 8"/>`);
  parts.push(`<text x="${d.x + 16}" y="${d.y + 34}" font-size="22" font-family="Georgia,serif" fill="#7a7f9a">draw your weapon here — side on</text>`);
  parts.push(`<path d="M ${d.x + d.w - 60} ${d.y + d.h / 2 - 26} L ${d.x + d.w - 18} ${d.y + d.h / 2} L ${d.x + d.w - 60} ${d.y + d.h / 2 + 26} Z" fill="#c9ccdb"/>`);
  parts.push(`<text x="${d.x + d.w - 78} " y="${d.y + d.h / 2 + 44}" text-anchor="end" font-size="20" font-family="Georgia,serif" fill="#9a9eb4">barrel points this way</text>`);

  CARD.rows.forEach((name, r) => {
    const y = CARD.rowY + r * CARD.rowStep;
    parts.push(`<text x="${CARD.draw.x + 10}" y="${y + 26}" font-size="24" font-family="Georgia,serif" fill="${ink}">${CARD.rowLabel[name]}</text>`);
    for (let p = 0; p < PIP_MAX; p++) {
      const x = CARD.pipX + p * CARD.pipStep;
      parts.push(`<rect x="${x}" y="${y}" width="${CARD.pipSize}" height="${CARD.pipSize}" rx="4" fill="none" stroke="#8f94ad" stroke-width="2"/>`);
    }
  });

  parts.push(`<text x="${CARD.draw.x + 10}" y="${CARD.patternY - 18}" font-size="24" font-family="Georgia,serif" fill="${ink}">HOW IT FIRES — tick one</text>`);
  CARD.patterns.forEach((p, k) => {
    const x = CARD.patternX + k * CARD.patternStep;
    parts.push(`<rect x="${x}" y="${CARD.patternY}" width="${CARD.patternSize}" height="${CARD.patternSize}" rx="4" fill="none" stroke="#8f94ad" stroke-width="2"/>`);
    parts.push(`<text x="${x + CARD.patternSize / 2}" y="${CARD.patternY + 68}" text-anchor="middle" font-size="19" font-family="Georgia,serif" fill="${ink}">${p}</text>`);
  });

  parts.push(`<text x="${w / 2}" y="${h - 96}" text-anchor="middle" font-size="19" font-family="Georgia,serif" fill="#8f94ad">Shade the boxes solid. Keep the four corner squares in shot. Photograph flat, in even light.</text>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${parts.join('')}</svg>`;
}
