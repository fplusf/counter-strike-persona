/**
 * Runs the browser harnesses against a live vite server and reports pass/fail.
 *
 *   dev/scanner.html  weapon-card OMR, under warp and shadow
 *   dev/weapons.html  the six firing patterns, each with a control case
 *
 * Usage: npm run dev  (in one terminal), then  npm run test
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const EXE = process.env.CHROME_PATH;

const browser = await chromium.launch({
  ...(EXE ? { executablePath: EXE } : {}),
  args: ['--no-sandbox'],
});
const page = await browser.newPage();
const failures = [];
page.on('pageerror', (e) => failures.push(`page error: ${e.message}`));

for (const [name, path, describe] of [
  ['weapon card scanner', '/dev/scanner.html',
    (r) => `${r.name} — detected=${r.detected} pattern=${r.gotPattern} pips=${r.pipsOk ? 'ok' : JSON.stringify(r.got)}`],
  ['firing patterns', '/dev/weapons.html',
    (r) => `${r.name} — hits=${r.hits} damage=${r.damage}`],
]) {
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  await page.waitForSelector('#results', { timeout: 60000 });
  const rows = JSON.parse(await page.textContent('#results'));
  console.log(`\n${name}`);
  for (const r of rows) {
    const ok = 'pass' in r ? r.pass : (r.detected && r.patternOk && r.pipsOk);
    if (!ok) failures.push(`${name}: ${r.name}`);
    console.log(`  ${ok ? 'pass' : 'FAIL'}  ${describe(r)}`);
  }
}

await browser.close();
console.log(failures.length ? `\n${failures.length} failing:\n  ${failures.join('\n  ')}` : '\nall green');
process.exit(failures.length ? 1 : 0);
