import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const OUT = process.env.SHOT_DIR ?? '.';
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
page.on('console', m => { const t = m.text(); if (m.type() === 'error' && !/ERR_CONNECTION_RESET|404/.test(t)) errs.push('CONSOLE ' + t); });
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/s1-menu.png` });

await page.getByRole('button', { name: 'New fighter' }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/s2-draw.png` });

// Draw a figure straight onto the pad.
const box = await page.locator('.draw-pad canvas').boundingBox();
const P = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];
async function line(pts) {
  await page.mouse.move(...P(...pts[0]));
  await page.mouse.down();
  for (const p of pts.slice(1)) { await page.mouse.move(...P(...p), { steps: 8 }); }
  await page.mouse.up();
}
// head, body, arms, legs
for (let i = 0; i <= 20; i++) {
  const a = (i / 20) * Math.PI * 2;
  if (i === 0) { await page.mouse.move(...P(0.5 + Math.cos(a) * 0.09, 0.11 + Math.sin(a) * 0.062)); await page.mouse.down(); }
  else await page.mouse.move(...P(0.5 + Math.cos(a) * 0.09, 0.11 + Math.sin(a) * 0.062), { steps: 3 });
}
await page.mouse.up();
await line([[0.5, 0.18], [0.5, 0.55]]);
await line([[0.32, 0.24], [0.5, 0.22], [0.68, 0.24]]);
await line([[0.32, 0.24], [0.26, 0.42], [0.22, 0.56]]);
await line([[0.68, 0.24], [0.74, 0.42], [0.78, 0.56]]);
await line([[0.5, 0.55], [0.42, 0.76], [0.39, 0.97]]);
await line([[0.5, 0.55], [0.58, 0.76], [0.61, 0.97]]);
await page.screenshot({ path: `${OUT}/s3-drawn.png` });

await page.getByRole('button', { name: 'Use this drawing' }).click();
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/s4-matte.png` });
await page.getByRole('button', { name: 'Pin the joints' }).click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: 'Guess from the drawing' }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/s5-pins.png` });
await page.locator('.text-input').fill('Inkling');
await page.getByRole('button', { name: 'Save fighter' }).click();
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/s6-back.png` });
console.log('cards on shelf:', await page.locator('.card strong').allTextContents());

// Weapon studio, via the printable-card route.
await page.getByRole('button', { name: 'New weapon' }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/s7-weapon.png` });
const wbox = await page.locator('.draw-pad canvas').boundingBox();
const W = (fx, fy) => [wbox.x + wbox.width * fx, wbox.y + wbox.height * fy];
await page.mouse.move(...W(0.12, 0.5)); await page.mouse.down();
for (const p of [[0.3, 0.42], [0.62, 0.42], [0.62, 0.58], [0.3, 0.6], [0.12, 0.5]]) await page.mouse.move(...W(...p), { steps: 6 });
await page.mouse.up();
await page.mouse.move(...W(0.62, 0.46)); await page.mouse.down();
await page.mouse.move(...W(0.95, 0.46), { steps: 10 }); await page.mouse.move(...W(0.95, 0.54), { steps: 3 }); await page.mouse.move(...W(0.62, 0.54), { steps: 10 });
await page.mouse.up();
await page.getByRole('button', { name: 'Use this drawing' }).click();
await page.waitForTimeout(700);
await page.getByRole('button', { name: 'Set the muzzle' }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/s8-anchors.png` });
await page.getByRole('button', { name: 'Set the stats' }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/s9-stats.png` });
console.log('ink readout:', await page.locator('.budget-text').textContent());
console.log('stats:', (await page.locator('.readout').textContent()).replace(/\n/g, ' / '));
// Push it over budget on purpose.
for (let i = 0; i < 6; i++) await page.locator('.pip-row').nth(i).locator('.pip').nth(7).click();
await page.waitForTimeout(200);
console.log('over budget:', await page.locator('.budget-text').textContent(),
            '| save disabled:', await page.getByRole('button', { name: 'Over budget' }).isDisabled());
await page.screenshot({ path: `${OUT}/s10-over.png` });
for (let i = 0; i < 6; i++) await page.locator('.pip-row').nth(i).locator('.pip').nth(2).click();
await page.locator('.text-input').fill('Scratchgun');
await page.getByRole('button', { name: 'Save weapon' }).click();
await page.waitForTimeout(900);
console.log('weapons on shelf:', await page.locator('.card-wide strong').allTextContents());
await page.screenshot({ path: `${OUT}/s11-final.png` });
console.log(errs.length ? errs.slice(0, 8).join('\n') : 'NO ERRORS');
await browser.close();
