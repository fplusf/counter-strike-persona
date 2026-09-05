/**
 * Round-trips a fighter through the export file: make one, export it, delete
 * it, import the file back. Also feeds the importer files it should refuse.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const browser = await chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
const errs = [];
const failures = [];
const check = (ok, what) => { console.log(`  ${ok ? 'pass' : 'FAIL'}  ${what}`); if (!ok) failures.push(what); };
page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(500);

// Make a fighter with the built-in pen.
await page.getByRole('button', { name: 'New fighter' }).click();
await page.waitForTimeout(300);
const box = await page.locator('.draw-pad canvas').boundingBox();
const P = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];
async function line(pts) {
  await page.mouse.move(...P(...pts[0]));
  await page.mouse.down();
  for (const p of pts.slice(1)) await page.mouse.move(...P(...p), { steps: 8 });
  await page.mouse.up();
}
await line([[0.42, 0.08], [0.58, 0.08], [0.58, 0.18], [0.42, 0.18], [0.42, 0.08]]);
await line([[0.5, 0.18], [0.5, 0.55]]);
await line([[0.3, 0.24], [0.5, 0.22], [0.7, 0.24]]);
await line([[0.3, 0.24], [0.24, 0.5]]);
await line([[0.7, 0.24], [0.76, 0.5]]);
await line([[0.5, 0.55], [0.42, 0.97]]);
await line([[0.5, 0.55], [0.58, 0.97]]);
await page.getByRole('button', { name: 'Use this drawing' }).click();
await page.waitForTimeout(600);
await page.getByRole('button', { name: 'Pin the joints' }).click();
await page.waitForTimeout(300);
await page.locator('.text-input').fill('Travelling Ink');
await page.getByRole('button', { name: 'Save fighter' }).click();
await page.waitForTimeout(700);

// Export it.
const wait = page.waitForEvent('download');
await page.getByRole('button', { name: 'export' }).first().click();
const dl = await wait;
const file = join(tmpdir(), dl.suggestedFilename());
await dl.saveAs(file);
const payload = JSON.parse(readFileSync(file, 'utf8'));
console.log(`\nexport / import (${dl.suggestedFilename()})`);
check(payload.kind === 'character', 'the file says what it holds');
check(Object.keys(payload.spec.rig).length === 13, 'all thirteen joints travel with it');
check(payload.spec.texture.startsWith('data:image/png;base64,'), 'the artwork travels inline');

// Delete it, then bring it back from the file.
page.once('dialog', (d) => d.accept());
await page.getByRole('button', { name: 'delete' }).first().click();
await page.waitForTimeout(600);
const afterDelete = await page.locator('.card strong').allTextContents();
await page.locator('input[type=file]').last().setInputFiles(file);
await page.waitForTimeout(900);
const afterImport = await page.locator('.card strong').allTextContents();
check(!afterDelete.includes('Travelling Ink'), 'delete removes it from the shelf');
check(afterImport.includes('Travelling Ink'), 'import puts it back on the shelf');

// Files the importer must refuse, without throwing.
console.log('\nfiles the importer must refuse');
const rejects = [
  ['not json at all', 'hello, I am a text file'],
  ['wrong version', JSON.stringify({ kind: 'character', version: 99, spec: {} })],
  ['script url as artwork', JSON.stringify({
    kind: 'character', version: 1,
    spec: { ...payload.spec, texture: 'javascript:alert(1)' } })],
  ['svg data url as artwork', JSON.stringify({
    kind: 'character', version: 1,
    spec: { ...payload.spec, texture: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' } })],
  ['nonsense joint values', JSON.stringify({
    kind: 'character', version: 1,
    spec: { ...payload.spec, rig: { ...payload.spec.rig, head: { x: 1e9, y: NaN } } } })],
];
for (const [name, body] of rejects) {
  const f = join(tmpdir(), 'bad.persona.json');
  writeFileSync(f, body);
  await page.locator('input[type=file]').last().setInputFiles(f);
  await page.waitForTimeout(500);
  const note = (await page.locator('.note').textContent().catch(() => '')) || '';
  const count = (await page.locator('.card strong').allTextContents()).length;
  check(Boolean(note) && count === 5, `refuses ${name} — ${note || 'no message shown'}`);
}

if (errs.length) failures.push(...errs);
await browser.close();
console.log(failures.length ? `\n${failures.length} failing` : '\nall green');
process.exit(failures.length ? 1 : 0);
