import type { CharacterSpec, Rig } from '../types';
import { DEFAULT_MATTE, loadImage, matte, type MatteOptions } from './imagePipeline';
import { DEFAULT_RIG, guessRig, JOINT_LABEL, JOINT_ORDER, maskOf } from './rig';
import { DrawCanvas } from './drawCanvas';
import { btn, el, fileInput, pinLayer, slider } from './ui';
import { saveCharacter, uid } from '../store';

/**
 *   pick a source ──> matte it ──> pin the joints ──> save
 *
 * The matte sliders and the pins are the only two things a person has to
 * understand, and both show their result the instant they move.
 */
export function openCharacterStudio(
  host: HTMLElement,
  onDone: (saved: CharacterSpec | null) => void,
  existing?: CharacterSpec,
) {
  const root = el('div', 'studio');
  host.replaceChildren(root);

  let photo: HTMLCanvasElement | null = null;
  let matted: HTMLCanvasElement | null = null;
  let rig: Rig = structuredClone(existing?.rig ?? DEFAULT_RIG);
  const opts: MatteOptions = { ...DEFAULT_MATTE };
  let worldHeight = existing?.worldHeight ?? 1.78;
  let name = existing?.name ?? 'My fighter';

  const header = el('header', 'studio-head');
  header.append(
    el('h1', undefined, 'Character studio'),
    el('p', 'muted', 'Draw a figure, or photograph one off paper. Ink on light paper reads best.'),
  );

  const stage = el('div', 'studio-stage');
  const side = el('aside', 'studio-side');
  const body = el('div', 'studio-body');
  body.append(stage, side);
  root.append(header, body);

  // ---------------------------------------------------------------- sources
  const pad = new DrawCanvas(620, 860);
  const upload = fileInput('image/*', async (file) => {
    const img = await loadImage(file);
    const c = el('canvas');
    const scale = Math.min(1, 1400 / Math.max(img.naturalWidth, img.naturalHeight));
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    photo = c;
    goToMatte();
  });

  const sourceRow = el('div', 'row');
  sourceRow.append(
    btn('Draw one', () => { photo = null; showPad(); }, 'btn primary'),
    btn('Upload a photo', () => upload.click()),
    upload,
  );

  function showPad() {
    stage.replaceChildren(pad.root);
    side.replaceChildren(
      block('Source', sourceRow),
      block('Next', wrap(btn('Use this drawing', () => {
        if (pad.isBlank) { note('Nothing on the page yet.'); return; }
        photo = pad.toPhoto();
        goToMatte();
      }, 'btn primary'))),
      tips([
        'Full body, arms and legs apart.',
        'A blank pose beats an action pose — the game does the moving.',
      ]),
    );
  }

  // ------------------------------------------------------------------ matte
  const preview = el('div', 'preview');
  const previewCanvas = el('canvas', 'preview-canvas');

  function runMatte() {
    if (!photo) return;
    const result = matte(photo, opts);
    matted = result.canvas;
    previewCanvas.width = result.width;
    previewCanvas.height = result.height;
    previewCanvas.getContext('2d')!.drawImage(result.canvas, 0, 0);
  }

  function goToMatte() {
    runMatte();
    preview.replaceChildren(previewCanvas);
    stage.replaceChildren(preview);
    const controls = el('div', 'controls');
    controls.append(
      slider('ink threshold', {
        min: 0.2, max: 0.95, step: 0.01, value: opts.cut,
        onInput: (v) => { opts.cut = v; runMatte(); },
      }),
      slider('edge softness', {
        min: 0, max: 0.45, step: 0.01, value: opts.feather,
        onInput: (v) => { opts.feather = v; runMatte(); },
      }),
      slider('drop ruled lines', {
        min: 0, max: 0.8, step: 0.01, value: opts.ruleReject,
        onInput: (v) => { opts.ruleReject = v; runMatte(); },
      }),
      slider('remove specks', {
        min: 0, max: 0.15, step: 0.005, value: opts.despeckle,
        onInput: (v) => { opts.despeckle = v; runMatte(); },
      }),
      slider('colour punch', {
        min: 1, max: 2.4, step: 0.05, value: opts.saturation,
        onInput: (v) => { opts.saturation = v; runMatte(); },
      }),
    );
    side.replaceChildren(
      block('Source', sourceRow),
      block('Cut out the paper', controls),
      block('Next', wrap(btn('Pin the joints', goToRig, 'btn primary'))),
      tips(['Push the threshold until the paper vanishes but the strokes stay whole.']),
    );
  }

  // -------------------------------------------------------------------- rig
  function goToRig() {
    if (!matted) return;
    preview.replaceChildren(previewCanvas);
    stage.replaceChildren(preview);

    const pins = pinLayer(
      preview,
      () => JOINT_ORDER.map((k) => ({ key: k, label: JOINT_LABEL[k], x: rig[k].x, y: rig[k].y })),
      (key, x, y) => { rig[key as keyof Rig] = { x, y }; },
    );

    const heightRow = slider('height in the world', {
      min: 1.2, max: 2.6, step: 0.01, value: worldHeight,
      format: (v) => `${v.toFixed(2)} m`,
      onInput: (v) => { worldHeight = v; },
    });

    const nameInput = el('input', 'text-input');
    nameInput.value = name;
    nameInput.oninput = () => { name = nameInput.value; };

    side.replaceChildren(
      block('Name', wrap(nameInput)),
      block('Joints', wrap(
        btn('Guess from the drawing', () => {
          rig = guessRig(maskOf(matted!));
          pins.refresh();
        }),
        btn('Reset to standard', () => { rig = structuredClone(DEFAULT_RIG); pins.refresh(); }),
      )),
      block('Scale', heightRow),
      block('Finish', wrap(
        btn('Save fighter', save, 'btn primary'),
        btn('Back', goToMatte),
      )),
      tips([
        'Drag each dot onto the matching part of your drawing.',
        'The cut-out is sliced along the lines between the dots, so rough is fine.',
      ]),
    );
    pins.refresh();
  }

  async function save() {
    if (!matted) return;
    const spec: CharacterSpec = {
      id: existing?.id ?? uid(),
      name: name.trim() || 'Nameless',
      texture: matted.toDataURL('image/png'),
      width: matted.width,
      height: matted.height,
      rig,
      worldHeight,
      createdAt: Date.now(),
    };
    await saveCharacter(spec);
    onDone(spec);
  }

  const bar = el('div', 'studio-bar');
  bar.append(btn('← Back to the desk', () => onDone(null)));
  root.append(bar);

  function note(text: string) {
    const n = el('p', 'note', text);
    side.append(n);
    setTimeout(() => n.remove(), 2600);
  }

  if (existing) {
    loadImage(existing.texture).then((img) => {
      const c = el('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d')!.drawImage(img, 0, 0);
      matted = c;
      previewCanvas.width = c.width; previewCanvas.height = c.height;
      previewCanvas.getContext('2d')!.drawImage(c, 0, 0);
      goToRig();
    });
  } else {
    showPad();
  }
}

function block(title: string, content: HTMLElement): HTMLElement {
  const b = el('section', 'block');
  b.append(el('h3', undefined, title), content);
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
