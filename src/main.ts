import './styles.css';
import type { CharacterSpec, WeaponSpec } from './types';
import { inkSpent } from './types';
import {
  deleteCharacter, deleteWeapon, listCharacters, listWeapons,
  loadLoadout, saveLoadout,
} from './store';
import { defaultCharacter, defaultWeapon } from './game/defaults';
import { openCharacterStudio } from './studio/characterStudio';
import { openWeaponStudio } from './studio/weaponStudio';
import { btn, el } from './studio/ui';
import { Game } from './game/game';

const app = document.querySelector<HTMLDivElement>('#app')!;
let loadout = loadLoadout();
let game: Game | null = null;

async function shelves() {
  const [chars, guns] = await Promise.all([listCharacters(), listWeapons()]);
  return {
    characters: [defaultCharacter(), ...chars.sort((a, b) => b.createdAt - a.createdAt)],
    weapons: [defaultWeapon(), ...guns.sort((a, b) => b.createdAt - a.createdAt)],
  };
}

async function menu(message?: string) {
  game?.dispose();
  game = null;
  const { characters, weapons } = await shelves();

  if (!loadout.characterId || !characters.some((c) => c.id === loadout.characterId)) {
    loadout.characterId = characters[0].id;
  }
  loadout.weaponIds = loadout.weaponIds.filter((id) => weapons.some((w) => w.id === id));
  if (!loadout.weaponIds.length) loadout.weaponIds = [weapons[0].id];
  saveLoadout(loadout);

  const root = el('div', 'menu');

  const title = el('header', 'menu-head');
  title.append(
    el('h1', 'title', 'PERSONA STRIKE'),
    el('p', 'tagline', 'Draw a fighter. Draw a gun. Draw how it fires. Then hold the line.'),
  );
  if (message) title.append(el('p', 'note', message));

  // ------------------------------------------------------------- characters
  const charSection = el('section', 'shelf');
  charSection.append(el('h2', undefined, 'Who are you'));
  const charRow = el('div', 'cards');
  for (const c of characters) {
    const card = el('button', 'card');
    card.type = 'button';
    card.dataset.on = String(loadout.characterId === c.id);
    const img = el('img');
    img.src = c.texture;
    img.alt = c.name;
    card.append(img, el('strong', undefined, c.name), el('em', undefined, `${c.worldHeight.toFixed(2)} m`));
    card.onclick = () => { loadout.characterId = c.id; saveLoadout(loadout); menu(); };
    const holder = el('div', 'card-holder');
    holder.append(card);
    if (c.createdAt > 0) {
      holder.append(
        btn('edit', () => openCharacterStudio(app, () => menu(), c), 'mini'),
        btn('delete', async () => { await deleteCharacter(c.id); menu(); }, 'mini danger'),
      );
    }
    charRow.append(holder);
  }
  const newChar = el('button', 'card card-new');
  newChar.type = 'button';
  newChar.append(el('span', 'plus', '+'), el('strong', undefined, 'New fighter'));
  newChar.onclick = () => openCharacterStudio(app, () => menu());
  charRow.append(newChar);
  charSection.append(charRow);

  // ---------------------------------------------------------------- weapons
  const gunSection = el('section', 'shelf');
  gunSection.append(
    el('h2', undefined, 'What you carry'),
    el('p', 'muted', 'Pick up to five. Number keys swap between them mid-fight.'),
  );
  const gunRow = el('div', 'cards');
  for (const w of weapons) {
    const card = el('button', 'card card-wide');
    card.type = 'button';
    const chosen = loadout.weaponIds.includes(w.id);
    card.dataset.on = String(chosen);
    const img = el('img');
    img.src = w.texture;
    img.alt = w.name;
    card.append(
      img,
      el('strong', undefined, w.name),
      el('em', undefined, `${w.pattern} · ${inkSpent(w.pips, w.pattern)} ink`),
    );
    card.onclick = () => {
      if (chosen) loadout.weaponIds = loadout.weaponIds.filter((id) => id !== w.id);
      else if (loadout.weaponIds.length < 5) loadout.weaponIds.push(w.id);
      if (!loadout.weaponIds.length) loadout.weaponIds = [w.id];
      saveLoadout(loadout);
      menu();
    };
    const holder = el('div', 'card-holder');
    holder.append(card);
    if (w.createdAt > 0) {
      holder.append(
        btn('edit', () => openWeaponStudio(app, () => menu(), w), 'mini'),
        btn('delete', async () => { await deleteWeapon(w.id); menu(); }, 'mini danger'),
      );
    }
    gunRow.append(holder);
  }
  const newGun = el('button', 'card card-wide card-new');
  newGun.type = 'button';
  newGun.append(el('span', 'plus', '+'), el('strong', undefined, 'New weapon'));
  newGun.onclick = () => openWeaponStudio(app, () => menu());
  gunRow.append(newGun);
  gunSection.append(gunRow);

  // --------------------------------------------------------------- play bar
  const play = el('div', 'play-bar');
  const start = btn('Hold the line', () => launch(characters, weapons), 'btn primary big');
  play.append(
    start,
    el('span', 'best', loadout.best ? `best  ${loadout.best}` : 'no runs yet'),
  );

  const help = el('section', 'shelf help');
  help.append(el('h2', undefined, 'Controls'));
  const table = el('dl');
  const rows: Array<[string, string]> = [
    ['WASD', 'move'], ['mouse', 'look'], ['click', 'fire'],
    ['shift', 'sprint'], ['ctrl / C', 'crouch'], ['space', 'jump'],
    ['R', 'reload'], ['1–5 / Q', 'swap weapon'], ['esc', 'release the mouse'],
  ];
  for (const [k, v] of rows) { table.append(el('dt', undefined, k), el('dd', undefined, v)); }
  help.append(table);

  root.append(title, charSection, gunSection, play, help);
  app.replaceChildren(root);
}

async function launch(characters: CharacterSpec[], weapons: WeaponSpec[]) {
  const character = characters.find((c) => c.id === loadout.characterId) ?? characters[0];
  const chosen = loadout.weaponIds
    .map((id) => weapons.find((w) => w.id === id))
    .filter((w): w is WeaponSpec => Boolean(w));

  const arena = el('div', 'arena');
  app.replaceChildren(arena);

  game = await Game.create({
    character,
    weapons: chosen.length ? chosen : [weapons[0]],
    container: arena,
    onExit(score, wave) {
      if (score > loadout.best) { loadout.best = score; saveLoadout(loadout); }
      menu(`Wave ${wave}. ${score} points. The page tore, but the drawing survives.`);
    },
  });
}

menu();
