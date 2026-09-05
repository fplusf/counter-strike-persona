import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const OUT = process.env.SHOT_DIR ?? '.';
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1024, height: 600 } });
const errors = [];
page.on('console', m => { const t = m.text(); if (m.type() === 'error' && !/ERR_CONNECTION_RESET|404/.test(t)) errors.push('CONSOLE ' + t); });
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));

await page.goto(BASE + '/?nolock', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/01-menu.png` });
await page.getByRole('button', { name: 'Hold the line' }).click();
await page.waitForTimeout(2500);

await page.evaluate(() => { window.__game.debugSummon('grunt'); window.__game.debugSummon('brute'); });
await page.waitForTimeout(2000);
await page.evaluate(() => { const g = window.__game, s = g.snapshot(); const e = s.enemies[0]; if (e) g.faceTowards(e.at[0], e.at[2]); });
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/03-enemy.png` });

await page.mouse.move(512, 300);
await page.mouse.down();
for (let i = 0; i < 14; i++) {
  await page.waitForTimeout(700);
  await page.evaluate(() => { const g = window.__game, s = g.snapshot(); const e = s.enemies.find(x => x.alive); if (e) g.faceTowards(e.at[0], e.at[2]); });
}
await page.mouse.up();
await page.screenshot({ path: `${OUT}/04-after-fire.png` });
const after = await page.evaluate(() => window.__game.snapshot());
console.log('after:', JSON.stringify({ score: after.score, enemies: after.enemies.map(e => `${e.kind} hp${e.hp} ${e.alive ? 'alive' : 'DEAD'}`) }));
console.log(errors.length ? errors.slice(0, 8).join('\n') : 'NO ERRORS');
await browser.close();
