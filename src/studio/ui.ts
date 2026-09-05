export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, cls?: string, text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function btn(text: string, onClick: () => void, cls = 'btn'): HTMLButtonElement {
  const b = el('button', cls, text);
  b.type = 'button';
  b.onclick = onClick;
  return b;
}

export interface SliderOpts {
  min: number; max: number; step: number; value: number;
  format?(v: number): string;
  onInput(v: number): void;
}

export function slider(label: string, o: SliderOpts): HTMLElement {
  const wrap = el('label', 'slider');
  const name = el('span', 'slider-name', label);
  const out = el('span', 'slider-value');
  const input = el('input');
  input.type = 'range';
  input.min = String(o.min); input.max = String(o.max);
  input.step = String(o.step); input.value = String(o.value);
  const show = (v: number) => { out.textContent = o.format ? o.format(v) : v.toFixed(2); };
  show(o.value);
  input.oninput = () => { const v = Number(input.value); show(v); o.onInput(v); };
  wrap.append(name, input, out);
  return wrap;
}

/** Draggable dots layered over a picture, in normalised coordinates. */
export interface PinLayerHandle {
  refresh(): void;
  element: HTMLElement;
}

export function pinLayer(
  host: HTMLElement,
  pins: () => Array<{ key: string; label: string; x: number; y: number }>,
  onMove: (key: string, x: number, y: number) => void,
): PinLayerHandle {
  const layer = el('div', 'pin-layer');
  host.append(layer);
  const nodes = new Map<string, HTMLElement>();

  function refresh() {
    const list = pins();
    const keep = new Set(list.map((p) => p.key));
    nodes.forEach((node, key) => { if (!keep.has(key)) { node.remove(); nodes.delete(key); } });

    for (const p of list) {
      let node = nodes.get(p.key);
      if (!node) {
        node = el('button', 'pin');
        node.dataset.key = p.key;
        node.append(el('i'), el('em', undefined, p.label));
        node.addEventListener('pointerdown', (ev) => {
          ev.preventDefault();
          (ev.target as HTMLElement).setPointerCapture?.(ev.pointerId);
          const rect = layer.getBoundingClientRect();
          const move = (m: PointerEvent) => {
            onMove(
              p.key,
              Math.min(1, Math.max(0, (m.clientX - rect.left) / rect.width)),
              Math.min(1, Math.max(0, (m.clientY - rect.top) / rect.height)),
            );
            refresh();
          };
          const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
          };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        });
        layer.append(node);
        nodes.set(p.key, node);
      }
      node.style.left = `${p.x * 100}%`;
      node.style.top = `${p.y * 100}%`;
    }
  }

  refresh();
  return { refresh, element: layer };
}

export function fileInput(accept: string, onFile: (f: File) => void): HTMLInputElement {
  const input = el('input');
  input.type = 'file';
  input.accept = accept;
  input.onchange = () => { const f = input.files?.[0]; if (f) onFile(f); input.value = ''; };
  return input;
}

export function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = el('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
