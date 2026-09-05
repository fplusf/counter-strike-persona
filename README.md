# Persona Strike

A wave shooter you draw yourself.

Draw a fighter on paper, photograph it, and it walks into the arena. Draw a
weapon on a printed card, shade the boxes for damage and fire rate, tick how it
fires, photograph that too — the game reads the card and builds the gun.
Everything runs in the browser; nothing is uploaded anywhere.

```
  your drawing ──scan──> a body that walks, aims, and falls over
  your weapon  ──scan──> a gun with real ballistics
  your marks   ──scan──> how it fires: spread, arc, ricochet, homing, beam
```

## Why the card

Most "draw your own character" games import the art and stop there. The picture
changes nothing about how the game plays, so drawing carefully earns you
nothing.

The Weapon Card fixes that. It is a printable sheet the scanner reads like an
exam bubble sheet: four corner marks give it a frame of reference, then it looks
up every pip box at a known address inside that frame. What you shade is what
the gun does.

```
  ■ ──────────────────── ■
  │                      │
  │    draw the gun      │
  │                      │
  │  DAMAGE   ▣▣▣▣▣▢▢▢   │
  │  FIRE RATE▣▣▣▢▢▢▢▢   │
  │  ACCURACY ▣▣▣▣▣▢▢▢   │
  │                      │
  │  ○ straight ● bounce │
  ■ ──────────────────── ■
```

Shaded pips cost ink, and the ink budget is fixed. A gun that hits hard fires
slowly, or holds four rounds, or sprays. You cannot draw a gun that wins.

No printer? The same stats are editable on screen, and there is a drawing pad
built in, so a laptop with no camera is enough to play.

## Running it

```
npm install
npm run dev          # http://localhost:5173
npm run build
npm test             # browser harnesses; needs the dev server running
```

`?nolock` on the game URL runs the loop without grabbing the mouse, which is how
the test harnesses drive it.

## How a drawing becomes a body

```
  photo
    │  divide by a heavily blurred copy of itself
    ▼     shadows, vignetting and off-white paper all cancel out
  even lighting
    │  threshold to alpha, drop pale ruled lines, remove specks
    ▼
  cut-out
    │  profile the silhouette: narrowest row under the head is the neck,
    ▼     first row that broadens is the shoulders, where one run of ink
  joint guess    becomes two is the crotch
    │  the player drags any pin they disagree with
    ▼
  rig
    │  hand every inked pixel to its nearest bone
    ▼
  ten paper scraps, each a quad whose UVs are cut along its bone
```

The last step is the one worth knowing about. An obvious way to size a limb is
to march outward from the bone until you stop finding ink — and it fails on the
first drawing anyone makes, because a drawn head is a hollow ring with nothing
to hit until the far rim. Nearest-bone assignment does not care: rim pixels are
closest to the head bone, so the head box grows to hold them. Every pixel lands
in exactly one box, so no part of the drawing is used twice.

The rest pose is then the drawing, pixel for pixel. Rotating the joints animates
it, like a cut-out puppet.

## The look

One extra scene pass and a fullscreen composite:

```
  scene ──┬── colour + depth ──┐
          └── normals ─────────┤
                               ├─ sobel ────────→ ink lines
  luminance ───────────────────┴─ three registers:
                                    light  → bare paper
                                    middle → cross-hatching
                                    dark   → solid ink
```

Two details do most of the work. Strongly coloured pixels are treated as
somebody's drawn stroke rather than a lit surface — they stay solid and keep
their own colour, which is why enemies read as red figures while the arena stays
blue-black. And the whole frame is re-jittered twelve times a second, so it
never sits perfectly still, the way a flipbook never traces itself twice.

Cut-out drawings are excluded from the normal pass. They already have their own
lines and should not be outlined twice.

## Tests

The two things most likely to break quietly have browser harnesses, at
`/dev/scanner.html` and `/dev/weapons.html`:

- **Weapon card** — prints a card, shades known pips, warps it through a real
  projective transform with a shadow gradient and sensor noise, reads it back,
  and compares. Five cases: flat, tilted two ways, blank, and fully shaded.
- **Firing patterns** — simulates each of the six patterns against a dummy body.
  Each has a control case: homing corrects a badly aimed shot *and* a straight
  round does not, a ricochet banks off a wall *and* a straight round does not.
  Without the control, the test would pass on a bug that made everything home.

## Layout

```
src/
  ink/paperPass.ts       the pen-and-paper renderer
  studio/
    imagePipeline.ts     photo -> flat lighting -> alpha cut-out
    rig.ts               joint guessing, nearest-bone part cutting
    cardScanner.ts       card layout, the printable sheet, the OMR reader
    characterStudio.ts   draw or upload -> matte -> pin joints -> save
    weaponStudio.ts      draw or scan -> anchors -> stats -> save
    drawCanvas.ts        the built-in pen
  game/
    game.ts              loop, waves, scoring
    paperDoll.ts         a drawing as a marionette of paper scraps
    weapon.ts            ballistics, the six patterns, the viewmodel
    enemy.ts             behaviour, kinds, ink splatter
    world.ts             the arena and its collision
```

## Not built yet

- Sound.
- Sharing a fighter as a single PNG with the rig in a text chunk, so a drawing
  can be passed to someone else.
- The eraser as a weapon: rub a wall off the page for a few seconds.
- Anything multiplayer.
