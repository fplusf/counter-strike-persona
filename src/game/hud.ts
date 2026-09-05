import type { WeaponInstance } from './weapon';

export interface HudState {
  score: number;
  wave: number;
  remaining: number;
  hp: number;
  maxHp: number;
  weapons: WeaponInstance[];
  active: number;
}

export class Hud {
  readonly root = document.createElement('div');
  private scoreEl = span('hud-score');
  private waveEl = span('hud-wave');
  private leftEl = span('hud-left');
  private hpBar = document.createElement('i');
  private hpText = span('hud-hp-text');
  private slotList = document.createElement('ul');
  private activeName = span('hud-weapon-name');
  private activeHint = span('hud-weapon-hint');
  private ammoEl = span('hud-ammo');
  private popups = document.createElement('div');
  private banner = document.createElement('div');
  private lastSignature = '';

  constructor() {
    this.root.className = 'hud';
    const tl = div('hud-tl'); tl.append(this.scoreEl);
    const tr = div('hud-tr'); tr.append(this.waveEl, this.leftEl);
    const bl = div('hud-bl');
    const bar = div('hud-hp'); bar.append(this.hpBar);
    bl.append(label('HP'), bar, this.hpText, this.ammoEl);
    const br = div('hud-br');
    this.slotList.className = 'hud-slots';
    br.append(this.slotList, this.activeName, this.activeHint);
    this.popups.className = 'hud-popups';
    this.banner.className = 'hud-banner';
    const cross = div('hud-cross');
    this.root.append(tl, tr, bl, br, this.popups, this.banner, cross);
  }

  update(s: HudState) {
    this.scoreEl.textContent = `SCORE ${s.score}`;
    this.waveEl.textContent = `WAVE ${s.wave}`;
    this.leftEl.textContent = `${s.remaining} ${s.remaining === 1 ? 'enemy' : 'enemies'} left`;
    const pct = Math.max(0, s.hp) / s.maxHp;
    this.hpBar.style.width = `${pct * 100}%`;
    this.hpBar.dataset.low = String(pct < 0.34);
    this.hpText.textContent = String(Math.ceil(Math.max(0, s.hp)));

    const w = s.weapons[s.active];
    if (w) {
      this.ammoEl.textContent = w.busy ? 'reloading…' : `${w.ammo}/${w.magazine}`;
      this.ammoEl.dataset.empty = String(!w.busy && w.ammo === 0);
      this.activeName.textContent = w.name.toUpperCase();
      this.activeHint.textContent = HINTS[w.stats.pattern];
    }

    const sig = s.weapons.map((x, i) => `${x.name}${i === s.active}${x.ammo}`).join('|');
    if (sig !== this.lastSignature) {
      this.lastSignature = sig;
      this.slotList.replaceChildren(...s.weapons.map((x, i) => {
        const li = document.createElement('li');
        li.dataset.active = String(i === s.active);
        li.innerHTML = `<b>${i + 1}</b> ${escapeHtml(x.name)} <em>${x.ammo}/${x.magazine}</em>`;
        return li;
      }));
    }
  }

  popup(text: string, kind: 'hit' | 'kill' | 'hurt' = 'hit') {
    const el = document.createElement('span');
    el.className = `pop pop-${kind}`;
    el.textContent = text;
    el.style.setProperty('--dx', `${(Math.random() - 0.5) * 90}px`);
    this.popups.append(el);
    setTimeout(() => el.remove(), 900);
  }

  say(text: string, ms = 1600) {
    this.banner.textContent = text;
    this.banner.dataset.on = 'true';
    window.setTimeout(() => { this.banner.dataset.on = 'false'; }, ms);
  }
}

const HINTS: Record<string, string> = {
  straight: 'plain shot — what you drew is what it does',
  spread: 'spread — one trigger pull, many holes',
  arc: 'lobbed — aim above what you want gone',
  bounce: 'ricochet — bank it around the corner',
  homing: 'homing — the ink finds them',
  beam: 'beam — hitscan, punches through',
};

function div(cls: string) { const e = document.createElement('div'); e.className = cls; return e; }
function span(cls: string) { const e = document.createElement('span'); e.className = cls; return e; }
function label(text: string) { const e = span('hud-label'); e.textContent = text; return e; }
function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
