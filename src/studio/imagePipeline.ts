/**
 * Turns a phone photo of a biro drawing into a game-ready RGBA cutout.
 *
 *   photo ──flatten──> even lighting ──matte──> alpha ──despeckle──> trim
 *
 * Everything runs on a 2D canvas so it works on any device with no upload.
 */

export interface MatteOptions {
  /** Lightness below which a pixel is fully ink. 0..1 */
  cut: number;
  /** Soft ramp above `cut` where the edge fades out. 0..1 */
  feather: number;
  /** Kill low-saturation pale blue/pink rules and grid lines. 0..1 */
  ruleReject: number;
  /** Drop connected blobs smaller than this fraction of the largest one. */
  despeckle: number;
  /** Push colour saturation so pencil reads on paper. 1 = untouched. */
  saturation: number;
}

export const DEFAULT_MATTE: MatteOptions = {
  cut: 0.55,
  feather: 0.22,
  ruleReject: 0.35,
  despeckle: 0.02,
  saturation: 1.45,
};

export interface Matted {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

const MAX_EDGE = 1024;

export async function loadImage(src: Blob | string): Promise<HTMLImageElement> {
  const url = typeof src === 'string' ? src : URL.createObjectURL(src);
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('Could not decode that image.'));
      img.src = url;
    });
    return img;
  } finally {
    if (typeof src !== 'string') setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function fitCanvas(img: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
  const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(h * scale));
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

/** Separable box blur over a single float channel — the background estimate. */
function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const win = r * 2 + 1;
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += src[y * w + Math.min(w - 1, Math.max(0, i))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = sum / win;
      const add = src[y * w + Math.min(w - 1, x + r + 1)];
      const sub = src[y * w + Math.max(0, x - r)];
      sum += add - sub;
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += tmp[Math.min(h - 1, Math.max(0, i)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / win;
      const add = tmp[Math.min(h - 1, y + r + 1) * w + x];
      const sub = tmp[Math.max(0, y - r) * w + x];
      sum += add - sub;
    }
  }
  return out;
}

/**
 * Divide the photo by a heavily blurred copy of itself. Shadows, phone
 * vignetting and off-white paper all cancel out; only the ink survives.
 *
 *   lit unevenly        blurred copy        quotient
 *   ▓▓▒▒░░ ink   ÷   ▓▓▒▒░░ (no ink)  =  ░░░░░░ ink
 */
function flatten(data: Uint8ClampedArray, w: number, h: number): Float32Array {
  const lum = new Float32Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    lum[p] = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
  }
  const radius = Math.max(6, Math.round(Math.max(w, h) / 24));
  const bg = boxBlur(lum, w, h, radius);
  const flat = new Float32Array(w * h);
  for (let p = 0; p < flat.length; p++) {
    flat[p] = Math.min(1, lum[p] / Math.max(0.06, bg[p]));
  }
  return flat;
}

/** Iterative two-pass label merge. Returns labels + pixel count per label. */
function components(alpha: Uint8Array, w: number, h: number) {
  const labels = new Int32Array(w * h).fill(-1);
  const stack: number[] = [];
  const sizes: number[] = [];
  for (let start = 0; start < labels.length; start++) {
    if (alpha[start] === 0 || labels[start] !== -1) continue;
    const id = sizes.length;
    let count = 0;
    stack.push(start);
    labels[start] = id;
    while (stack.length) {
      const p = stack.pop()!;
      count++;
      const x = p % w, y = (p / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (alpha[q] !== 0 && labels[q] === -1) { labels[q] = id; stack.push(q); }
        }
      }
    }
    sizes.push(count);
  }
  return { labels, sizes };
}

export function matte(source: HTMLCanvasElement, opt: MatteOptions): Matted {
  const w = source.width, h = source.height;
  const sctx = source.getContext('2d', { willReadFrequently: true })!;
  const img = sctx.getImageData(0, 0, w, h);
  const d = img.data;
  const flat = flatten(d, w, h);

  const out = new ImageData(w, h);
  const o = out.data;
  const mask = new Uint8Array(w * h);
  const lo = opt.cut, hi = Math.min(1, opt.cut + opt.feather);

  for (let p = 0, i = 0; p < flat.length; p++, i += 4) {
    const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;

    // Ruled lines are pale AND weakly coloured. Real strokes are one or neither.
    const pale = 1 - flat[p];
    const ruleness = Math.max(0, 1 - pale / Math.max(0.02, opt.ruleReject)) * (1 - sat);

    let a = 1 - smoothstep(lo, hi, flat[p]);
    a *= 1 - Math.min(1, ruleness);

    // Keep the ink's own colour, pushed away from grey.
    const l = (max + min) / 2;
    const s = opt.saturation;
    o[i] = clamp255((l + (r - l) * s) * 255);
    o[i + 1] = clamp255((l + (g - l) * s) * 255);
    o[i + 2] = clamp255((l + (b - l) * s) * 255);
    o[i + 3] = clamp255(a * 255);
    mask[p] = a > 0.35 ? 1 : 0;
  }

  if (opt.despeckle > 0) {
    const { labels, sizes } = components(mask, w, h);
    const biggest = sizes.length ? Math.max(...sizes) : 0;
    const floor = biggest * opt.despeckle;
    for (let p = 0, i = 3; p < labels.length; p++, i += 4) {
      const id = labels[p];
      if (id >= 0 && sizes[id] < floor) o[i] = 0;
    }
  }

  const staged = document.createElement('canvas');
  staged.width = w; staged.height = h;
  staged.getContext('2d')!.putImageData(out, 0, 0);
  return trim(staged);
}

/** Crop to the ink's bounding box with a small margin. */
export function trim(canvas: HTMLCanvasElement, margin = 4): Matted {
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const d = ctx.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 24) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return { canvas, width: w, height: h };
  x0 = Math.max(0, x0 - margin); y0 = Math.max(0, y0 - margin);
  x1 = Math.min(w - 1, x1 + margin); y1 = Math.min(h - 1, y1 + margin);
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const c = document.createElement('canvas');
  c.width = cw; c.height = ch;
  c.getContext('2d')!.drawImage(canvas, x0, y0, cw, ch, 0, 0, cw, ch);
  return { canvas: c, width: cw, height: ch };
}

/**
 * Evenly lit luminance, 0 (ink) to 1 (paper). Anything that has to make a
 * dark-or-light decision about a photograph should read this, not the raw
 * pixels — a shadow across one corner of a page otherwise reads as ink.
 */
export function flattenLuminance(canvas: HTMLCanvasElement) {
  const w = canvas.width, h = canvas.height;
  const d = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  return { g: flatten(d, w, h), w, h };
}

export function prepare(img: HTMLImageElement, opt: MatteOptions): Matted {
  return matte(fitCanvas(img, img.naturalWidth, img.naturalHeight), opt);
}

function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / Math.max(1e-5, b - a)));
  return t * t * (3 - 2 * t);
}
function clamp255(v: number) { return v < 0 ? 0 : v > 255 ? 255 : v; }
