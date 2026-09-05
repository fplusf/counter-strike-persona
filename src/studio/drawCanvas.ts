/** A small pen so someone with no scanner and no printer can still play. */
export class DrawCanvas {
  readonly root = document.createElement('div');
  readonly canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private history: ImageData[] = [];
  private drawing = false;
  private last: { x: number; y: number } | null = null;
  private colour = '#1e2b78';
  private size = 6;
  private erasing = false;

  constructor(width = 720, height = 900) {
    this.root.className = 'draw-pad';
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
    this.clear();

    const tools = document.createElement('div');
    tools.className = 'draw-tools';

    for (const c of ['#1e2b78', '#111111', '#b21226', '#1c7a4a', '#c8811a', '#7a2f9e']) {
      const b = document.createElement('button');
      b.className = 'swatch';
      b.style.background = c;
      b.onclick = () => { this.colour = c; this.erasing = false; sync(); };
      b.dataset.colour = c;
      tools.append(b);
    }

    const width_ = document.createElement('input');
    width_.type = 'range'; width_.min = '2'; width_.max = '38'; width_.value = '6';
    width_.oninput = () => { this.size = Number(width_.value); };
    width_.title = 'nib width';

    const eraser = button('eraser', () => { this.erasing = !this.erasing; sync(); });
    const undo = button('undo', () => this.undo());
    const clear = button('clear', () => { this.pushHistory(); this.clear(); });

    tools.append(width_, eraser, undo, clear);
    this.root.append(tools, this.canvas);

    const sync = () => {
      eraser.dataset.on = String(this.erasing);
      tools.querySelectorAll<HTMLElement>('.swatch').forEach((s) => {
        s.dataset.on = String(!this.erasing && s.dataset.colour === this.colour);
      });
    };
    sync();

    const pos = (e: PointerEvent) => {
      const r = this.canvas.getBoundingClientRect();
      return {
        x: ((e.clientX - r.left) / r.width) * this.canvas.width,
        y: ((e.clientY - r.top) / r.height) * this.canvas.height,
      };
    };

    this.canvas.addEventListener('pointerdown', (e) => {
      this.canvas.setPointerCapture(e.pointerId);
      this.pushHistory();
      this.drawing = true;
      this.last = pos(e);
      this.stroke(this.last, this.last, e.pressure || 0.5);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.drawing || !this.last) return;
      const p = pos(e);
      this.stroke(this.last, p, e.pressure || 0.5);
      this.last = p;
    });
    const stop = () => { this.drawing = false; this.last = null; };
    this.canvas.addEventListener('pointerup', stop);
    this.canvas.addEventListener('pointercancel', stop);
  }

  private stroke(a: { x: number; y: number }, b: { x: number; y: number }, pressure: number) {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = this.erasing ? 'destination-out' : 'source-over';
    ctx.strokeStyle = this.colour;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = this.size * (this.erasing ? 2.4 : 0.5 + pressure);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }

  private pushHistory() {
    this.history.push(this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height));
    if (this.history.length > 24) this.history.shift();
  }

  undo() {
    const prev = this.history.pop();
    if (prev) this.ctx.putImageData(prev, 0, 0);
  }

  clear() { this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); }

  /** Flatten onto paper so the matte pipeline sees the same thing a photo would. */
  toPhoto(): HTMLCanvasElement {
    const out = document.createElement('canvas');
    out.width = this.canvas.width;
    out.height = this.canvas.height;
    const ctx = out.getContext('2d')!;
    ctx.fillStyle = '#fdfbf2';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(this.canvas, 0, 0);
    return out;
  }

  get isBlank(): boolean {
    const d = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height).data;
    for (let i = 3; i < d.length; i += 40) if (d[i] > 8) return false;
    return true;
  }
}

function button(text: string, onClick: () => void) {
  const b = document.createElement('button');
  b.className = 'tool';
  b.textContent = text;
  b.onclick = onClick;
  return b;
}
