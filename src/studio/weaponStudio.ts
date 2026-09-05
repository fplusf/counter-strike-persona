import type { FirePattern, WeaponPips, WeaponSpec, Vec2 } from '../types';
import { INK_BUDGET, PATTERN_SURCHARGE, PIP_MAX, inkSpent, resolveWeapon } from '../types';
import { DEFAULT_MATTE, loadImage, matte, type MatteOptions } from './imagePipeline';
import { DrawCanvas } from './drawCanvas';
import { btn, download, el, fileInput, pinLayer, slider } from './ui';
import { buildCardSvg, CARD, scanCard } from './cardScanner';
import { saveWeapon, uid } from '../store';

const PIP_ROWS: Array<keyof WeaponPips> = ['damage', 'fireRate', 'accuracy', 'ammo', 'reload', 'count'];
const PIP_LABEL: Record<keyof WeaponPips, string> = {
  damage: 'damage', fireRate: 'fire rate', accuracy: 'accuracy',
  ammo: 'magazine', reload: 'reload speed', count: 'projectiles',
};

export function openWeaponStudio(
  host: HTMLElement,
  onDone: (saved: WeaponSpec | null) => void,
  existing?: WeaponSpec,
) {
  const root = el('div', 'studio');
  host.replaceChildren(root);

  let photo: HTMLCanvasElement | null = null;
  let matted: HTMLCanvasElement | null = null;
  const opts: MatteOptions = { ...DEFAULT_MATTE, despeckle: 0.01 };
  let pips: WeaponPips = existing?.pips ?? { damage: 4, fireRate: 4, accuracy: 4, ammo: 4, reload: 3, count: 1 };
  let pattern: FirePattern = existing?.pattern ?? 'straight';
  let muzzle: Vec2 = existing?.muzzle ?? { x: 0.95, y: 0.5 };
  let grip: Vec2 = existing?.grip ?? { x: 0.2, y: 0.8 };
  let name = existing?.name ?? 'My weapon';

  const header = el('header', 'studio-head');
  header.append(
    el('h1', undefined, 'Weapon studio'),
    el('p', 'muted', 'Draw the gun. Then say how it fires — on screen, or on a printed card the camera reads for you.'),
  );

  const stage = el('div', 'studio-stage');
  const side = el('aside', 'studio-side');
  const bodyWrap = el('div', 'studio-body');
  bodyWrap.append(stage, side);
  root.append(header, bodyWrap);

  const pad = new DrawCanvas(900, 340);
  const preview = el('div', 'preview preview-wide');
  const previewCanvas = el('canvas', 'preview-canvas');

  const uploadPlain = fileInput('image/*', async (f) => { photo = await toCanvas(f); goToMatte(); });
  const uploadCard = fileInput('image/*', async (f) => {
    const source = await toCanvas(f);
    const result = scanCard(source);
    photo = result.artwork;
    if (result.cardDetected) {
      pips = clampPips(result.pips);
      pattern = result.pattern;
      flash(`Card read — ${describe(pips, pattern)}`);
    } else {
      flash('No corner marks found, so the whole photo was used as artwork. Stats left as they were.');
    }
    goToMatte();
  });

  const sourceRow = el('div', 'row');
  sourceRow.append(
    btn('Draw one', () => { photo = null; showPad(); }, 'btn primary'),
    btn('Upload artwork', () => uploadPlain.click()),
    btn('Scan a weapon card', () => uploadCard.click()),
    uploadPlain, uploadCard,
  );

  const cardRow = el('div', 'row');
  cardRow.append(
    btn('Download the printable card', () => {
      download('weapon-card.svg', new Blob([buildCardSvg()], { type: 'image/svg+xml' }));
    }),
    btn('Print it now', () => {
      const w = window.open('', '_blank');
      if (!w) return;
      w.document.write(`<style>@page{margin:0}body{margin:0}svg{width:100vw}</style>${buildCardSvg()}`);
      w.document.close();
      w.focus();
      w.print();
    }),
  );

  function showPad() {
    stage.replaceChildren(pad.root);
    side.replaceChildren(
      block('Source', sourceRow),
      block('Paper route', cardRow),
      block('Next', wrap(btn('Use this drawing', () => {
        if (pad.isBlank) { flash('Nothing drawn yet.'); return; }
        photo = pad.toPhoto();
        goToMatte();
      }, 'btn primary'))),
      tips(['Draw it side on, barrel pointing right.', 'Big and bold beats small and fiddly.']),
    );
  }

  function runMatte() {
    if (!photo) return;
    const r = matte(photo, opts);
    matted = r.canvas;
    previewCanvas.width = r.width;
    previewCanvas.height = r.height;
    previewCanvas.getContext('2d')!.drawImage(r.canvas, 0, 0);
  }

  function goToMatte() {
    runMatte();
    if (matted && !existing) {
      const found = autoAnchors(matted);
      muzzle = found.muzzle;
      grip = found.grip;
    }
    preview.replaceChildren(previewCanvas);
    stage.replaceChildren(preview);
    const controls = el('div', 'controls');
    controls.append(
      slider('ink threshold', { min: 0.2, max: 0.95, step: 0.01, value: opts.cut, onInput: (v) => { opts.cut = v; runMatte(); } }),
      slider('edge softness', { min: 0, max: 0.45, step: 0.01, value: opts.feather, onInput: (v) => { opts.feather = v; runMatte(); } }),
      slider('drop ruled lines', { min: 0, max: 0.8, step: 0.01, value: opts.ruleReject, onInput: (v) => { opts.ruleReject = v; runMatte(); } }),
      slider('remove specks', { min: 0, max: 0.15, step: 0.005, value: opts.despeckle, onInput: (v) => { opts.despeckle = v; runMatte(); } }),
    );
    side.replaceChildren(
      block('Source', sourceRow),
      block('Cut out the paper', controls),
      block('Next', wrap(btn('Set the muzzle', goToAnchors, 'btn primary'))),
    );
  }

  function goToAnchors() {
    preview.replaceChildren(previewCanvas);
    stage.replaceChildren(preview);
    const pins = pinLayer(
      preview,
      () => [
        { key: 'muzzle', label: 'muzzle', x: muzzle.x, y: muzzle.y },
        { key: 'grip', label: 'grip', x: grip.x, y: grip.y },
      ],
      (key, x, y) => { if (key === 'muzzle') muzzle = { x, y }; else grip = { x, y }; },
    );
    side.replaceChildren(
      block('Anchors', el('p', 'muted', 'Muzzle is where shots leave. Grip is the corner of the screen your hand sits in.')),
      block('', wrap(btn('Guess again', () => {
        if (!matted) return;
        const a = autoAnchors(matted);
        muzzle = a.muzzle; grip = a.grip;
        pins.refresh();
      }))),
      block('Next', wrap(btn('Set the stats', goToStats, 'btn primary'), btn('Back', goToMatte))),
    );
    pins.refresh();
  }

  // ------------------------------------------------------------------ stats
  function goToStats() {
    preview.replaceChildren(previewCanvas);
    stage.replaceChildren(preview);

    const budget = el('div', 'budget');
    const budgetBar = el('i');
    const budgetText = el('span', 'budget-text');
    budget.append(budgetBar, budgetText);

    const grid = el('div', 'pip-grid');
    const patternWrap = el('div', 'pattern-grid');
    const readout = el('pre', 'readout');

    const nameInput = el('input', 'text-input');
    nameInput.value = name;
    nameInput.oninput = () => { name = nameInput.value; };

    const saveBtn = btn('Save weapon', save, 'btn primary');

    function paint() {
      grid.replaceChildren();
      for (const key of PIP_ROWS) {
        const row = el('div', 'pip-row');
        row.append(el('span', 'pip-label', PIP_LABEL[key]));
        for (let i = 1; i <= PIP_MAX; i++) {
          const p = el('button', 'pip');
          p.type = 'button';
          p.dataset.on = String(pips[key] >= i);
          p.onclick = () => { pips[key] = pips[key] === i ? i - 1 : i; paint(); };
          row.append(p);
        }
        row.append(el('span', 'pip-count', String(pips[key])));
        grid.append(row);
      }

      patternWrap.replaceChildren();
      for (const p of CARD.patterns) {
        const b = el('button', 'pattern');
        b.type = 'button';
        b.dataset.on = String(pattern === p);
        b.append(el('strong', undefined, p), el('em', undefined, `+${PATTERN_SURCHARGE[p]} ink`));
        b.onclick = () => { pattern = p; paint(); };
        patternWrap.append(b);
      }

      const spent = inkSpent(pips, pattern);
      const over = spent > INK_BUDGET;
      budgetBar.style.width = `${Math.min(100, (spent / INK_BUDGET) * 100)}%`;
      budgetBar.dataset.over = String(over);
      budgetText.textContent = `${spent} / ${INK_BUDGET} ink`;
      saveBtn.disabled = over;
      saveBtn.textContent = over ? 'Over budget' : 'Save weapon';

      const r = resolveWeapon({ pips, pattern } as WeaponSpec);
      readout.textContent =
        `${r.damage.toFixed(0)} damage  ×${r.projectiles} per shot\n` +
        `${(1 / r.interval).toFixed(1)} shots/sec   ${(r.spread * 1000).toFixed(0)} mrad spread\n` +
        `${r.magazine} rounds   ${r.reloadTime.toFixed(2)}s reload\n` +
        `sustained: ${(r.damage * r.projectiles / r.interval).toFixed(0)} dps`;
    }

    side.replaceChildren(
      block('Name', wrap(nameInput)),
      block('Ink budget', budget),
      block('Stats', grid),
      block('How it fires', patternWrap),
      block('What that means', readout),
      block('Finish', wrap(saveBtn, btn('Back', goToAnchors))),
    );
    paint();
  }

  async function save() {
    if (!matted) return;
    const spec: WeaponSpec = {
      id: existing?.id ?? uid(),
      name: name.trim() || 'Unnamed',
      texture: matted.toDataURL('image/png'),
      width: matted.width,
      height: matted.height,
      muzzle, grip, pattern, pips,
      createdAt: Date.now(),
    };
    await saveWeapon(spec);
    onDone(spec);
  }

  const bar = el('div', 'studio-bar');
  bar.append(btn('← Back to the desk', () => onDone(null)));
  root.append(bar);

  function flash(text: string) {
    const n = el('p', 'note', text);
    side.prepend(n);
    setTimeout(() => n.remove(), 5000);
  }

  if (existing) {
    loadImage(existing.texture).then((img) => {
      const c = el('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d')!.drawImage(img, 0, 0);
      matted = c;
      previewCanvas.width = c.width; previewCanvas.height = c.height;
      previewCanvas.getContext('2d')!.drawImage(c, 0, 0);
      goToStats();
    });
  } else {
    showPad();
  }
}

async function toCanvas(file: File): Promise<HTMLCanvasElement> {
  const img = await loadImage(file);
  const c = el('canvas');
  const scale = Math.min(1, 1500 / Math.max(img.naturalWidth, img.naturalHeight));
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

/**
 * Barrels point right and hands go under the body, so the muzzle is the ink
 * furthest right and the grip is the ink furthest down-left. Both are pins the
 * player can drag afterwards, so a wrong guess costs one gesture.
 */
function autoAnchors(canvas: HTMLCanvasElement): { muzzle: Vec2; grip: Vec2 } {
  const w = canvas.width, h = canvas.height;
  const d = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  let mx = 0, mySum = 0, myN = 0;
  let gx = w, gy = 0, gScore = -Infinity;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] <= 40) continue;
      if (x > mx) { mx = x; mySum = y; myN = 1; }
      else if (x === mx) { mySum += y; myN++; }
      const score = (y / h) * 1.0 - (x / w) * 0.55;
      if (score > gScore) { gScore = score; gx = x; gy = y; }
    }
  }
  return {
    muzzle: { x: Math.min(0.995, (mx + 2) / w), y: myN ? mySum / myN / h : 0.5 },
    grip: { x: gx / w, y: gy / h },
  };
}

function clampPips(p: WeaponPips): WeaponPips {
  const c = (v: number) => Math.max(0, Math.min(PIP_MAX, Math.round(v)));
  return {
    damage: c(p.damage), fireRate: c(p.fireRate), accuracy: c(p.accuracy),
    ammo: c(p.ammo), reload: c(p.reload), count: Math.max(1, c(p.count)),
  };
}

function describe(p: WeaponPips, pattern: FirePattern) {
  return `${pattern}, ${p.damage} dmg / ${p.fireRate} rate / ${p.accuracy} acc, ${inkSpent(p, pattern)} ink`;
}

function block(title: string, content: HTMLElement): HTMLElement {
  const b = el('section', 'block');
  if (title) b.append(el('h3', undefined, title));
  b.append(content);
  return b;
}
function wrap(...nodes: HTMLElement[]): HTMLElement {
  const w = el('div', 'row');
  w.append(...nodes);
  return w;
}
function tips(lines: string[]): HTMLElement {
  const ul = el('ul', 'tips');
  lines.forEach((l) => ul.append(el('li', undefined, l)));
  return ul;
}
