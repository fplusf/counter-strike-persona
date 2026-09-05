import type { CharacterSpec, FirePattern, JointName, Rig, Vec2, WeaponSpec } from './types';
import { PIP_MAX } from './types';
import { JOINT_ORDER } from './studio/rig';

/**
 * A fighter drawn on a phone has to reach the desktop the game is played on,
 * so a character or weapon travels as one small file.
 *
 *   phone: photograph, matte, pin ──export──> fighter.persona.json
 *                                                    │
 *   desktop: ──import──> straight onto the shelf ─────┘
 *
 * The file is also how one person hands a drawing to another, so nothing
 * inside it is trusted. Everything is re-checked on the way in.
 */
export const SHARE_VERSION = 1;

export type SharePayload =
  | { kind: 'character'; version: number; spec: CharacterSpec }
  | { kind: 'weapon'; version: number; spec: WeaponSpec };

export function exportSpec(kind: 'character' | 'weapon', spec: CharacterSpec | WeaponSpec): Blob {
  const payload = { kind, version: SHARE_VERSION, spec };
  return new Blob([JSON.stringify(payload)], { type: 'application/json' });
}

export function shareFilename(kind: string, name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || kind;
  return `${slug}.persona.json`;
}

export class ImportError extends Error {}

/** Only inline images. A texture field is fed to an <img>, so nothing else. */
const DATA_IMAGE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

function num(v: unknown, lo: number, hi: number, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) {
    throw new ImportError(`${what} is out of range`);
  }
  return v;
}

function vec(v: unknown, what: string): Vec2 {
  const o = v as Vec2;
  if (!o || typeof o !== 'object') throw new ImportError(`${what} is missing`);
  return { x: num(o.x, -2, 3, `${what}.x`), y: num(o.y, -2, 3, `${what}.y`) };
}

function text(v: unknown, max: number, fallback: string): string {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : fallback;
}

function texture(v: unknown): string {
  if (typeof v !== 'string' || !DATA_IMAGE.test(v)) {
    throw new ImportError('the artwork is missing or is not an inline image');
  }
  // ~12 MB of base64 is far past any drawing this game produces.
  if (v.length > 12_000_000) throw new ImportError('the artwork is too large');
  return v;
}

const PATTERNS: FirePattern[] = ['straight', 'spread', 'arc', 'bounce', 'homing', 'beam'];

export function parseShare(json: string): SharePayload {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new ImportError('that file is not readable as a fighter or a weapon');
  }
  const p = raw as { kind?: unknown; version?: unknown; spec?: unknown };
  if (p.version !== SHARE_VERSION) throw new ImportError('that file came from a different version');
  const spec = p.spec as Record<string, unknown>;
  if (!spec || typeof spec !== 'object') throw new ImportError('that file has no drawing in it');

  const common = {
    texture: texture(spec.texture),
    width: num(spec.width, 8, 4096, 'width'),
    height: num(spec.height, 8, 4096, 'height'),
    createdAt: Date.now(),
  };

  if (p.kind === 'character') {
    const rigIn = (spec.rig ?? {}) as Record<string, unknown>;
    const rig = {} as Rig;
    for (const joint of JOINT_ORDER) rig[joint as JointName] = vec(rigIn[joint], joint);
    return {
      kind: 'character',
      version: SHARE_VERSION,
      spec: {
        ...common,
        id: crypto.randomUUID(),
        name: text(spec.name, 40, 'Imported fighter'),
        rig,
        worldHeight: num(spec.worldHeight, 0.4, 6, 'height in the world'),
      },
    };
  }

  if (p.kind === 'weapon') {
    const pipsIn = (spec.pips ?? {}) as Record<string, unknown>;
    const pip = (k: string) => Math.round(num(pipsIn[k], 0, PIP_MAX, k));
    const pattern = PATTERNS.includes(spec.pattern as FirePattern)
      ? (spec.pattern as FirePattern) : 'straight';
    return {
      kind: 'weapon',
      version: SHARE_VERSION,
      spec: {
        ...common,
        id: crypto.randomUUID(),
        name: text(spec.name, 40, 'Imported weapon'),
        muzzle: vec(spec.muzzle, 'muzzle'),
        grip: vec(spec.grip, 'grip'),
        pattern,
        pips: {
          damage: pip('damage'), fireRate: pip('fireRate'), accuracy: pip('accuracy'),
          ammo: pip('ammo'), reload: pip('reload'), count: Math.max(1, pip('count')),
        },
      },
    };
  }

  throw new ImportError('that file is neither a fighter nor a weapon');
}
