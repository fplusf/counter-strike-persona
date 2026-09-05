import type { CharacterSpec, Rig, WeaponSpec } from '../types';

/**
 * Nobody should hit a wall on first launch. These are drawn in code with the
 * same biro the rest of the game uses, and the rig is built from the very
 * coordinates the figure is drawn from, so it is exact rather than guessed.
 */

const INK = '#1e2b78';

function pen(ctx: CanvasRenderingContext2D, width: number) {
  ctx.strokeStyle = INK;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

/** Hand-drawn line: a few passes, each wandering slightly off true. */
function stroke(ctx: CanvasRenderingContext2D, pts: [number, number][], passes = 2, jitter = 1.6) {
  for (let p = 0; p < passes; p++) {
    ctx.beginPath();
    pts.forEach(([x, y], i) => {
      const jx = x + (Math.random() - 0.5) * jitter;
      const jy = y + (Math.random() - 0.5) * jitter;
      if (i === 0) ctx.moveTo(jx, jy); else ctx.lineTo(jx, jy);
    });
    ctx.stroke();
  }
}

function circle(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, passes = 2) {
  for (let p = 0; p < passes; p++) {
    ctx.beginPath();
    for (let i = 0; i <= 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      const rr = r + (Math.random() - 0.5) * 2.2;
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

const W = 320, H = 620;
const P = {
  head: [160, 62], neck: [160, 116], hip: [160, 330],
  shoulderL: [118, 138], elbowL: [88, 226], handL: [76, 312],
  shoulderR: [202, 138], elbowR: [232, 226], handR: [244, 312],
  kneeL: [136, 462], footL: [128, 600],
  kneeR: [186, 462], footR: [196, 600],
} as const;

export function defaultCharacter(): CharacterSpec {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  pen(ctx, 5);

  circle(ctx, P.head[0], P.head[1], 44, 2);
  // A face, so it reads as somebody rather than a diagram.
  pen(ctx, 4);
  stroke(ctx, [[144, 54], [144, 62]], 2, 1);
  stroke(ctx, [[176, 54], [176, 62]], 2, 1);
  stroke(ctx, [[142, 80], [160, 88], [178, 80]], 2, 1.2);

  pen(ctx, 6);
  stroke(ctx, [P.neck as unknown as [number, number], P.hip as unknown as [number, number]]);
  stroke(ctx, [[P.shoulderL[0], P.shoulderL[1]], [P.shoulderR[0], P.shoulderR[1]]]);
  stroke(ctx, [[P.shoulderL[0], P.shoulderL[1]], [P.elbowL[0], P.elbowL[1]], [P.handL[0], P.handL[1]]]);
  stroke(ctx, [[P.shoulderR[0], P.shoulderR[1]], [P.elbowR[0], P.elbowR[1]], [P.handR[0], P.handR[1]]]);
  stroke(ctx, [[P.hip[0], P.hip[1]], [P.kneeL[0], P.kneeL[1]], [P.footL[0], P.footL[1]]]);
  stroke(ctx, [[P.hip[0], P.hip[1]], [P.kneeR[0], P.kneeR[1]], [P.footR[0], P.footR[1]]]);

  const rig = Object.fromEntries(
    Object.entries(P).map(([k, [x, y]]) => [k, { x: x / W, y: y / H }]),
  ) as unknown as Rig;

  return {
    id: 'default-recruit',
    name: 'Recruit',
    texture: c.toDataURL('image/png'),
    width: W, height: H,
    rig,
    worldHeight: 1.78,
    createdAt: 0,
  };
}

export function defaultWeapon(): WeaponSpec {
  const w = 660, h = 240;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  pen(ctx, 5);

  stroke(ctx, [[40, 150], [120, 118], [300, 112], [300, 158], [120, 168], [40, 150]]);  // body
  stroke(ctx, [[300, 124], [620, 124], [620, 146], [300, 146]]);                        // barrel
  stroke(ctx, [[176, 168], [168, 232], [214, 232], [206, 168]]);                        // magazine
  stroke(ctx, [[122, 168], [112, 214], [140, 214], [148, 168]]);                        // grip
  stroke(ctx, [[196, 112], [206, 82], [268, 82], [278, 112]]);                          // sight
  stroke(ctx, [[600, 112], [600, 158]]);                                                // muzzle brake
  pen(ctx, 3);
  stroke(ctx, [[330, 132], [560, 132]], 1, 1);

  return {
    id: 'default-rifle',
    name: 'Biro Rifle',
    texture: c.toDataURL('image/png'),
    width: w, height: h,
    muzzle: { x: 634 / w, y: 135 / h },
    grip: { x: 130 / w, y: 200 / h },
    pattern: 'straight',
    pips: { damage: 4, fireRate: 6, accuracy: 6, ammo: 5, reload: 5, count: 1 },
    createdAt: 0,
  };
}
