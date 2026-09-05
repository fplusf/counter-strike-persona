import { KINDS, type EnemyKind } from './enemy';

/**
 * Waves are bought from a points budget rather than hand-listed, so the curve
 * keeps going after the authored waves run out.
 *
 *   budget = 6 + wave * 4        rushers appear at 2, marksmen at 3, brutes at 5
 */
const COST: Record<string, number> = { grunt: 3, rusher: 4, marks: 5, brute: 12 };

export function composeWave(wave: number): EnemyKind[] {
  const pool = ['grunt'];
  if (wave >= 2) pool.push('rusher');
  if (wave >= 3) pool.push('marks');
  if (wave >= 5 && wave % 2 === 1) pool.push('brute');

  let budget = 6 + wave * 4;
  const out: EnemyKind[] = [];
  let guard = 200;
  while (budget > 0 && guard-- > 0) {
    const affordable = pool.filter((k) => COST[k] <= budget);
    if (!affordable.length) break;
    const pick = affordable[(Math.random() * affordable.length) | 0];
    budget -= COST[pick];
    out.push(KINDS[pick]);
    if (out.length >= 26) break;
  }
  return out.length ? out : [KINDS.grunt];
}

/** How many of the wave may be on the map at once. */
export function concurrency(wave: number): number {
  return Math.min(10, 3 + Math.floor(wave / 2));
}
