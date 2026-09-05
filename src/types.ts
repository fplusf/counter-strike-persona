/** Joint pins the player places over their drawing. Normalised 0..1 image space. */
export type JointName =
  | 'head' | 'neck' | 'hip'
  | 'shoulderL' | 'elbowL' | 'handL'
  | 'shoulderR' | 'elbowR' | 'handR'
  | 'kneeL' | 'footL'
  | 'kneeR' | 'footR';

export type Vec2 = { x: number; y: number };

export type Rig = Record<JointName, Vec2>;

export interface CharacterSpec {
  id: string;
  name: string;
  /** Trimmed, matted RGBA drawing as a data URL. */
  texture: string;
  /** Source pixel size of `texture`. */
  width: number;
  height: number;
  rig: Rig;
  /** World height in metres the drawing is scaled to. */
  worldHeight: number;
  createdAt: number;
}

export type FirePattern =
  | 'straight'   // plain bullet
  | 'spread'     // shotgun cone
  | 'arc'        // lobbed, gravity-affected
  | 'bounce'     // ricochets off walls
  | 'homing'     // curves toward nearest enemy
  | 'beam';      // hitscan line, pierces

/** Every stat is 0..8 pips, exactly as shaded on the printed card. */
export interface WeaponPips {
  damage: number;
  fireRate: number;
  accuracy: number;
  ammo: number;
  reload: number;
  count: number;
}

export interface WeaponSpec {
  id: string;
  name: string;
  texture: string;
  width: number;
  height: number;
  /** Muzzle point in normalised texture space; projectiles leave from here. */
  muzzle: Vec2;
  /** Grip point, aligned to the bottom-right of the viewport. */
  grip: Vec2;
  pattern: FirePattern;
  pips: WeaponPips;
  createdAt: number;
}

export const PIP_MAX = 8;
/** Total shaded pips allowed across all six stats. Keeps scanned guns honest. */
export const INK_BUDGET = 24;

export const PATTERN_SURCHARGE: Record<FirePattern, number> = {
  straight: 0,
  spread: 2,
  arc: 2,
  bounce: 3,
  homing: 5,
  beam: 4,
};

export function inkSpent(pips: WeaponPips, pattern: FirePattern): number {
  return (
    pips.damage + pips.fireRate + pips.accuracy +
    pips.ammo + pips.reload + pips.count +
    PATTERN_SURCHARGE[pattern]
  );
}

/**
 * Metres per second by pattern. A homing round that travels as fast as a
 * rifle bullet reaches the target before it has time to curve, so the
 * behaviour you paid ink for never shows up — slow ones read as guided.
 */
const PROJECTILE_SPEED: Record<FirePattern, number> = {
  straight: 78,
  spread: 70,
  arc: 34,
  bounce: 52,
  homing: 26,
  beam: 0,
};

/** Pips -> the numbers the simulation actually runs on. */
export function resolveWeapon(spec: WeaponSpec) {
  const p = spec.pips;
  const lerp = (a: number, b: number, t: number) => a + (b - a) * (t / PIP_MAX);
  return {
    damage: lerp(6, 46, p.damage),
    /** seconds between shots */
    interval: lerp(0.62, 0.07, p.fireRate),
    /** cone half-angle, radians */
    spread: lerp(0.115, 0.004, p.accuracy),
    magazine: Math.round(lerp(4, 60, p.ammo)),
    reloadTime: lerp(2.6, 0.65, p.reload),
    projectiles: spec.pattern === 'spread'
      ? Math.round(lerp(3, 14, p.count))
      : Math.max(1, Math.round(lerp(1, 4, p.count))),
    speed: PROJECTILE_SPEED[spec.pattern],
    pattern: spec.pattern,
  };
}
export type ResolvedWeapon = ReturnType<typeof resolveWeapon>;
