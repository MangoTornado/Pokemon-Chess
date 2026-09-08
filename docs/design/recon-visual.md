# Recon: Art Direction & Animation

**Role:** art director / animation designer.
**Status:** authoritative for visual and motion decisions. Subordinate to
[`DIRECTION.md`](./DIRECTION.md) (which makes visuals an acceptance criterion) and to
[`recon-data-substrate.md`](./recon-data-substrate.md) for asset facts.
**Method:** read the live source (`src/ui/*`), rendered the existing board (`board-smoke.png`), and measured
every colour claim numerically. Probe scripts in `/tmp/pkmn-probe/`:
`artdirector-vis-{bbox,outcomes,tokens,nudge}.mjs`, `artdir-{cvd,contrast,board,final,assets}.mjs`.

---

## 0. The seven findings that drive everything below

Each of these is measured, not asserted. They are the reason the design is shaped the way it is.

1. **The current board surface is the worst possible surface for the 18 type colours.** Against the current
   dark square `#A97A52`, **all 18 of 18** type colours fall below 3:1 contrast (worst: Psychic 1.19,
   Water 1.21). Against the light square `#EBD4A7`, **13 of 18** fall below 3:1 (worst: Electric 1.04).
   That is the arithmetic behind "the board reads as mud". The tan/brown board must go.
2. **No single board lightness can carry both armies *and* 18 hues.** The type colours span relative
   luminance 0.107 (Dark) → 0.651 (Electric) — a 6× spread. A dark board erases the 5 dark types; a light
   board erases the other 13. The optimum square lightness for a bone-vs-ink army pair is L ≈ 0.181,
   which yields exactly **4.12:1 to both extremes** and no better. Therefore the type colour must never be
   asked to contrast the board: it must contrast a *per-piece* element of fixed lightness.
3. **Colour cannot encode the four capture outcomes.** Measured: the natural outcome colours sit
   ΔE 11.8–19.2 from the nearest *type* colour (gold ↔ Electric 11.8, hot-orange ↔ Fire 13.2,
   cyan ↔ Ice 16.2, steel ↔ Steel 11.0), and under protanopia two of them collapse to ΔE 6.6. **Outcomes
   must be encoded by form, direction, symmetry and count. Colour is decoration only.** This single finding
   determines the whole animation design in §4.
4. **The 18 fixed type colours are not colour-blind safe and cannot be made so.** Measured CIELAB ΔE across
   all 153 pairs: 0 pairs under ΔE 10 for normal vision, but **7 pairs under ΔE 10 under deuteranopia**
   (worst: Poison/Ghost 3.6, Fire/Bug 4.9, Fire/Rock 6.8, Ice/Steel 7.4, Grass/Rock 7.6, Grass/Ground 7.8,
   Normal/Psychic 9.1), 3 under protanopia (Water/Flying **3.3**, Fire/Rock 7.1, Poison/Ghost 9.2), 2 under
   tritanopia (Electric/Ground 4.9, Normal/Bug 7.7). `typeColors.ts` is fixed by decree and *should* stay
   fixed — recognition is the point. So type identity needs a **second, non-colour channel: 18 shapes.**
5. **There is a clean luminance partition of the 18 types at exactly 5 / 13.** Fighting, Poison, Ghost,
   Dragon and Dark have relative luminance 0.107–0.138; every other type is ≥ 0.284. Nothing sits in
   between. That gap is a gift: one boolean per type drives the "which liner / which pool" decision
   everywhere in the UI, and it gives a **worst-case 4.95:1** edge contrast across all 18 types (§2.4).
6. **The sprite occupies only a fifth of its cell, and its corners are reliably empty.** Decoding the
   383 KB icon sheet (1629 non-empty 40×30 cells): median opaque bounding box **23×22 px**, median fill
   **20%** of the cell, sprites bottom-anchored (median `maxy` = 27 of 30). The **top-left 8×8 px is fully
   empty in 91% of icons** (top-right 90%, bottom-left 91%); at 10×10 that drops to 75%/76%/71%. But the
   **bottom 6 rows are fully empty in only 1%** of icons. Conclusion: a role crest can live in the top-left
   corner almost for free; an opaque bottom bar cannot.
7. **Animated sprites are neither universal nor uniformly sized.** `Sprites.getPokemon(id, {gen:'ani'})`
   returns `133×140` for Charizard, `84×78` for Gengar, and silently falls back to a `96×96` static
   `gen5` PNG for Miraidon and Pecharunt. So a board cannot be laid out around animated GIF dimensions.
   **All motion quality must come from effects we draw.** (Confirms `recon-data-substrate.md` §6.)

---

## 1. Art direction

### 1.1 The identity, in one line

> **A national championship, played at night, with gym badges for pieces.**

The board is a tournament-grade slate slab with an ink-inlaid grid. Each piece is a **cloisonné enamel pin**
— a metal bezel enclosing a field of type-coloured enamel with the Pokémon set into it — and **the pin's
outline is its chess role**. Captured pins go into a tray, tarnished. The room is dark, the slab is lit, and
the only thing in the whole game allowed to *glow* is a super-effective capture.

### 1.2 Why this and not something else

Gym Badges are the one piece of canon Pokémon design language that is already *exactly* the object we need:
a small, collectible, silhouette-differentiated, type-coloured enamel token. Adopting them
- solves role legibility with **shape**, which is the only channel that survives 40 px, colour blindness and
  a dense board (§2);
- gives the type colour a home with a guaranteed-contrast border, which finding 2 says it must have;
- justifies the cloisonné double-edge that makes the contrast maths work (§2.4);
- is authentic rather than invented, which `DIRECTION.md` requires of mechanics and should also require of
  art; and
- looks like nothing else. There is no other chess game whose pieces are a tray of enamel pins.

The typographic register is deliberately **serious, not cute**. The tension between a sober tournament
frame and 1025 Pokémon *is* the identity: this is a real competition that happens to be played with
Pokémon. The whimsy is carried entirely by the sprites and the type colours; the chrome stays quiet so they
can be loud.

### 1.3 What it must NOT look like

Be strict about these; each is a real failure mode this project is currently one step away from.

| Not this | Why it is wrong here | The tell to avoid |
|---|---|---|
| **Dark-mode SaaS dashboard** (what `global.css` is today) | `#0E1116` page + `#161B22` cards + `#2B323C` 1 px borders + `#58A6FF` links is GitHub's palette. It reads as a developer tool, not a game. | 8 px-radius bordered cards in a grid; blue as an accent; `--text-dim` grey body copy everywhere |
| **Neon / synthwave** | If everything glows, the super-effective capture cannot. Glow is a *budget*, and we spend all of it on one beat. | outer glows on idle UI, chromatic gradients, scanlines |
| **Wooden lichess board** | Measured: 18/18 type colours fail 3:1 on the current dark tan. | any warm mid-brown square |
| **Cutesy rounded mobile-puzzle** | Undercuts the tournament frame and makes 16-piece armies read as candy. | ≥16 px radii, bubble buttons, coloured drop shadows, bouncy everything |
| **AI-default editorial** (cream `#F4F1EA` + high-contrast serif + terracotta) | It is the current house style of generated design, and it has nothing to do with either chess or Pokémon. | Playfair/DM Serif display over cream, hairline rules, zero radius |
| **Flat Material** | The pieces are *metal*. Elevation here is a bevel (light top edge, dark bottom edge), not a grey blur. | `box-shadow: 0 2px 4px rgba(0,0,0,.2)` as the only depth cue |

### 1.4 Palette

The 18 values in `src/ui/typeColors.ts` are **fixed and unchanged**. They are the spine. Everything below is
the neutral scaffolding built around them, and it is deliberately **low-chroma and blue-cool** so that every
one of the 18 hues reads as the most saturated thing on screen.

```css
:root {
  /* ---- ink & stage ---------------------------------------------------- */
  --ink:          #0B0E14;  /* every outline, every hairline, the deepest value  */
  --stage:        #12161F;  /* page background — the dark room                   */
  --panel:        #171C27;  /* rails, HUD panels                                 */
  --panel-raised: #1F2634;  /* chips, buttons, inspector card                    */
  --hairline:     #2A3242;  /* 1px divisions inside panels                       */

  /* ---- the slab ------------------------------------------------------- */
  --sq-dark:      #5C6575;  /* L 0.129 */
  --sq-light:     #818A9B;  /* L 0.252 — checker ratio 1.69:1 */
  --sq-inlay:     rgba(11,14,20,0.34);   /* 1px ink grid between squares        */
  --slab-edge:    #C9A227;  /* brass frame around the board, 2px, decorative only */

  /* ---- armies (the bezel metals) ------------------------------------- */
  --army-light:   #F5F1E8;  /* "Ivory Steel"  — 5.21:1 / 3.08:1 vs the squares  */
  --army-light-2: #B9B2A3;  /* its shadow half, for the bevel gradient          */
  --army-dark:    #0F131A;  /* "Obsidian Steel" — 3.17:1 / 5.35:1 vs the squares */
  --army-dark-2:  #4A5364;  /* its specular half                                 */
  /* army separation: 15.2:1. Also carried by bezel shape and rim-light direction. */

  /* ---- type-adaptive edges (see §2.4) -------------------------------- */
  --liner-ink:    #0B0E14;  /* used for the 13 light types  */
  --liner-bone:   #F5F1E8;  /* used for Fighting/Poison/Ghost/Dragon/Dark */

  /* ---- text ---------------------------------------------------------- */
  --text:         #F5F1E8;  /* 16.1:1 on --stage */
  --text-2:       #A9B2C2;  /*  8.5:1 on --stage — secondary, never body copy */
  --text-3:       #8D97AB;  /*  5.2:1 on --panel-raised — labels only, ≥12px */

  /* ---- accents (used sparingly and for one thing each) --------------- */
  --brass:        #C9A227;  /* structure: board frame, inlay, dividers */
  --gold:         #FFC53D;  /* RESERVED: the extra move, and nothing else. 11.5:1 on --stage */
  --gold-hot:     #FFF3D6;  /* the 1-frame impact flash */
  --crit:         #FF7A45;  /* RESERVED: the die-6 cause stamp only */
  --ash:          #6B7280;  /* dead / captured / spent */
  --ward:         #CBD3E1;  /* the no-effect hexagon */
}
```

Rules the palette must be used by:

- **`--gold` is a reserved word.** It appears only when a side owns an unspent extra move. Never a hover
  state, never a heading, never a button. Its scarcity is what makes §4.1 land.
- **`--gold` never carries an edge by itself.** Measured: `#FFC53D` is only **2.20:1** on `--sq-light`. Every
  gold ring on the board is drawn as gold inner + `--ink` 1 px outer.
- **Chroma discipline.** No scaffolding colour may exceed CIELAB C\* ≈ 18 except `--brass`, `--gold` and
  `--crit`. Everything else is grey-blue. This is what makes 18 saturated hues survive on one screen.
- **The board is the brightest large area.** The slab is lighter than the chrome, so the eye goes to the
  board. Panels recede; the game does not.

### 1.5 Typography

Two families, three roles. A variable-width display face gives one family two jobs, which is a system
rather than a mood board.

| Role | Face | Fallback stack | Where |
|---|---|---|---|
| **Display** | **Archivo** (variable: `wght` 100–900, `wdth` 62–125) | `'Archivo', 'Archivo Expanded', 'Helvetica Neue', Arial, sans-serif` | Title, screen headings, the four outcome banners, army names, post-game result |
| **Body / UI** | **IBM Plex Sans** | `'IBM Plex Sans', ui-sans-serif, system-ui, 'Segoe UI', Roboto, sans-serif` | Everything readable: card copy, tooltips, move descriptions, buttons, labels |
| **Data / notation** | **IBM Plex Mono** | `'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace` | Move list, square coordinates, the clock, seeds, dice values, point-buy costs, `V(piece)` numbers |

Why: Archivo's width axis lets the title be set at `wdth 118` (arena signage) and the HUD's small caps
labels at `wdth 78` (a scoreboard tickertape) **from the same family** — one download, two voices. IBM Plex
Sans is engineered and slightly squared, so it sits with Archivo without competing, and its Mono sibling is
the right face for chess notation, which is data and should look like data. Neither is the default reach
(no Inter, no Oswald, no Playfair).

Type scale — a 1.25 ratio, capped at 8 steps, all in `rem`:

| Token | Size | LH | Face / setting |
|---|---|---|---|
| `--t-display` | 3.25rem / 52px | 0.96 | Archivo 800, `wdth 118`, tracking `-0.02em`, uppercase |
| `--t-h1` | 2rem / 32px | 1.05 | Archivo 700, `wdth 106`, `-0.015em` |
| `--t-h2` | 1.375rem / 22px | 1.15 | Archivo 650, `wdth 100` |
| `--t-h3` | 1.0625rem / 17px | 1.3 | Plex Sans 600 |
| `--t-body` | 0.9375rem / 15px | 1.55 | Plex Sans 400 |
| `--t-small` | 0.8125rem / 13px | 1.45 | Plex Sans 400 |
| `--t-label` | 0.6875rem / 11px | 1.1 | Archivo 700, `wdth 78`, uppercase, tracking `0.10em` |
| `--t-data` | 0.875rem / 14px | 1.3 | Plex Mono 500, `font-variant-numeric: tabular-nums` |

`--t-label` is the workhorse and the signature: every HUD label, every column head, every type chip is set
in it. It is the visual equivalent of a tournament placard.

Never: italics anywhere (this is signage, not prose); more than two weights per screen; `letter-spacing`
on anything below 11 px other than `--t-label`.

### 1.6 Spacing, radii, elevation

```
Spacing ladder (4-based, named):  --s1 4  --s2 8  --s3 12  --s4 16  --s6 24  --s8 32  --s12 48  --s16 64
Radii:   --r-chip 3   --r-panel 6   --r-slab 4   --r-badge 50% (or the role path)
         Nothing in this game has a radius above 6px except the pins themselves.
Board:   max 720px square desktop · 512px tablet · 8 × 40 = 320px mobile floor
Rails:   left inspector 300px · right turn rail 288px · collapse below 1180px
```

Elevation is a **bevel**, because the objects are metal:

| Level | Use | CSS |
|---|---|---|
| `e0` | board inlay, hazard decals | `inset 0 1px 0 rgba(255,255,255,.05)` |
| `e1` | panels, rails | `inset 0 1px 0 rgba(255,255,255,.045), 0 8px 24px -14px #000` |
| `e2` | **a pin at rest** | `inset 0 1.5px 0 rgba(255,255,255,.38), inset 0 -1.5px 0 rgba(0,0,0,.45), 0 2px 3px rgba(6,8,12,.55)` |
| `e3` | a pin that is acting (lifted) | `0 10px 18px -6px rgba(6,8,12,.72)` + `scale(1.10) translateY(-6%)` |
| `e4` | overlay / promotion stage | `rgba(8,10,14,.62)` + `backdrop-filter: blur(6px)` |

The `inset` pair in `e2` is load-bearing, not decoration: it is what makes `--army-dark` pins read on the
dark square (a bright top edge) and `--army-light` pins read on the light square (a dark bottom edge).

### 1.7 Empty and loading states

- **Board loading.** The icon sheet is one 383 KB request. While it is in flight, render the *real board
  with the real pins minus their sprites*: bezels, role silhouettes, type enamel, all correct. The sprites
  then fade in over 180 ms, staggered 12 ms in reading order. A skeleton that is the finished thing minus
  one layer, not a grey rectangle. It also means the *chess* is legible before the Pokémon arrive.
- **Dex failed to load.** Panel with `--t-h2` "The Pokédex did not load", one line of what to try
  ("Check your connection and reload"), a `Retry` button, and the error string behind a
  `<details>Technical detail</details>`. No apology, no emoji, in the interface's voice.
- **Empty collection.** Not "you have no Pokémon". A single card: "Pick your first six." with the starter
  selection inline. An empty screen is an invitation to act.
- **Empty captured tray.** The tray shows 16 recessed, empty pin *sockets* per side, so material count is
  legible as "how many sockets are filled" from move one. Absence is drawn, not blank.
- **Empty move list.** One line of `--t-data`: `1. …` with the cursor. It teaches the format.

---

## 2. Role legibility — the urgent problem

### 2.1 Why the current attempt fails

`src/ui/pieceRoles.ts` and `BoardPiece.tsx` already try three channels: a Unicode chess glyph badge, a
sprite-size hierarchy (1.25 → 1.7), and a ring weight (3 → 5 cqmin). The owner still cannot read roles. The
reasons are structural, not effort:

1. **Font glyphs at board scale are indistinguishable.** On a 40 px square the badge is 15 px and the glyph
   inside it ~10 px. At 10 px, `♜ ♝ ♛` are three similar dark blobs of near-identical mass — they differ
   only in interior detail, which is exactly what disappears first. The code's own comment documents a
   fight with U+FE0E and colour-emoji presentation; that is a warning that font-delivered symbols are not
   controllable enough to be the primary channel.
2. **Three size tiers is two too few for six roles.** `ROLE_SPRITE_SCALE` collapses to 1.25 / 1.45 / 1.7, so
   knight, bishop and rook are pixel-identical in size, and 1.45 vs 1.7 is a 17% difference that no one can
   judge across non-adjacent squares.
3. **Ring weight is invisible.** 3 vs 3.5 cqmin on a 40 px square is 1.2 px vs 1.4 px.
4. **Everything competes for the same real estate.** Role badge, sprite and type ring all occupy the centre
   of a 40 px cell, and finding 6 says the sprite's own bounding box is only ~23×22 with reliably empty
   corners — the layout is fighting for space it did not need to fight for.

### 2.2 The recommendation: silhouette first, and derive the silhouette from the movement

**Encode the chess role as the pin's outer silhouette, and make each silhouette a picture of how the piece
moves.** Silhouette is the only channel that survives downscaling (it is what remains when detail is gone),
is immune to colour blindness, and is how humans actually recognise physical chess pieces.

| Role | Silhouette | Derivation — why this shape | Cell fill |
|---|---|---|---|
| **Pawn** | **Circle** | The plain token. No ornament, smallest. | 66% |
| **Bishop** | **Diamond** (square rotated 45°) | It moves on the diagonals; its outline *is* the diagonals. | 74% |
| **Rook** | **Square with a 4-notch crenellated top** | It moves on the orthogonals; a battlement, squared to the file and rank. | 76% |
| **Knight** | **Stepped "L" hexomino** (2 across, 1 up, corners chamfered 2px) | The shape is literally the knight's move. Nothing else on the board is asymmetric. | 74% |
| **Queen** | **Octagon** + 5-point coronet on the top edge | Rook's square ∪ bishop's diamond = an octagon. The geometry states the rule: she is both. | 86% |
| **King** | **Heraldic shield** (flat top, pointed base) + arched crown with cross finial, breaking the top of the cell by 6% | The only escutcheon and the only shape that overflows its square. | 92% |

Six grossly different outlines: round / diamond / crenellated square / asymmetric L / crowned octagon /
crowned shield. The distinctions are in **gross outline and symmetry class**, not interior detail:
1-fold (knight, asymmetric), 2-fold (shield), 4-fold (diamond, square), 8-fold (octagon), ∞-fold (circle).

Six SVG paths in a 64×64 viewBox is the entire art bill. They ship as inline `<path>` data in
`src/ui/roleShapes.ts` — never as a font, never as an image request.

### 2.3 The full pin anatomy

```
   40px cell (mobile floor)                    88px cell (desktop)
  ┌────────────────────────┐               ┌──────────────────────────────┐
  │ ╔══════════════════╗   │               │  ╔════════════════════════╗  │
  │ ║ ✕                ║   │  ← crest      │  ║ ✕                   R  ║  │ ← crest + letter
  │ ║   ▓▓ sprite ▓▓   ║   │               │  ║                        ║  │
  │ ║  ▓▓▓▓▓▓▓▓▓▓▓▓    ║   │               │  ║     ▓▓ sprite ▓▓       ║  │
  │ ║                ⚗ ║   │  ← status     │  ║    ▓▓▓▓▓▓▓▓▓▓▓▓▓       ║  │
  │ ╚══════════════════╝   │               │  ║                     ⚗  ║  │
  │      ▂▂▂ shadow        │               │  ╚════════════════════════╝  │
  └────────────────────────┘               │  ◈ FIRE          ⛨ ✦        │ ← type + hooks
                                            └──────────────────────────────┘
   ╔══╗ = the role silhouette (bezel).  Not a rectangle — it is one of the six paths.
```

Concentric structure, outside in — five strokes, each with one job:

| # | Layer | Size | Carries | Guaranteed by |
|---|---|---|---|---|
| 1 | **Ink halo** | 1 px `--ink` at 55% | Separates the pin from the board on light squares | 3.29:1 / 5.56:1 |
| 2 | **Bezel** | 3 px (min 2 px at 40 px cell), the role path | **Role** (shape) + **army** (metal) | 15.2:1 army separation; ≥3.03:1 vs both squares |
| 3 | **Liner** | 1 px, `--liner-ink` or `--liner-bone` per §2.4 | Separates enamel from bezel | worst case **4.95:1** |
| 4 | **Enamel** | the remaining field, radial `pool → rim` | **Type** (hue) | rim = the canonical hex, unmodified |
| 5 | **Sprite** | the icon, `imageRendering: pixelated`, bottom-anchored, offset up 6% | **Species** | ≥3.16:1 vs its own pool |

Redundant channels, ranked by the size at which each stops working:

| Channel | Encodes | Works down to | Notes |
|---|---|---|---|
| Bezel silhouette | role | **~22 px** | primary; the only one that must never be omitted |
| Pin size (6 tiers, 66→92% of cell) | role | ~28 px | a real 6-step ladder, not 3 |
| Crest glyph, top-left | role | ~34 px cell | `▲ ⌐ ✕ ✚ ✳ ✳⃝` — the move geometry again, monochrome |
| Role letter, top-right | role | ~64 px cell | `K Q R B N P`, Plex Mono 600, engraved into the bezel |
| Crown overflow | royalty | ~20 px | king and queen break the cell's top edge; nothing else does |
| Bezel metal (ivory / obsidian) | army | any | 15.2:1 |
| Bezel edge treatment | army | ~30 px | light army = smooth polished bezel; dark army = **12-tooth fluted** bezel |
| Rim-light direction | army | ~30 px | light army lit from top-left; dark army lit from bottom-right |
| Sprite facing | army | any | already implemented via `flipped` |
| Pawn chevron direction | army | ~34 px | the pawn crest `▲` points the way that army advances |
| Enamel hue | type | any | 18 values, fixed |
| Type glyph | type | ~44 px cell | 18 monochrome marks, bottom-left of the enamel, §7.1 |

**Responsive rule** — channels switch on by cell size, never off by media query (use a container query on
the square, as the code already does with `cqmin`):

```
cell < 34px : silhouette + size + crown + metal + hue                    (5 channels)
cell ≥ 34px : + crest glyph + fluting + rim light + pawn chevron         (9)
cell ≥ 44px : + type glyph                                              (10)
cell ≥ 64px : + role letter + ability/item hook glyphs on the plinth     (12)
```

### 2.4 The liner rule (the thing that makes the contrast maths work)

> **A type's liner is `--ink` for the 13 light types and `--bone` for the 5 dark types — Fighting, Poison,
> Ghost, Dragon, Dark. The enamel pool is darkened 35% toward ink for the 13 and lightened 30% toward bone
> for the 5.**

This is one boolean derived from finding 5 (the luminance gap at 0.138 → 0.284), and it delivers:

| Guarantee | Measured worst case |
|---|---|
| enamel rim vs its liner | **4.95:1** (Poison) |
| enamel pool vs the sprite's best outline | **4.26:1** (Bug) |
| liner vs bezel | ≥ 4.5:1 both armies |

Full table (rim / liner / pool), for direct transcription into `src/ui/typeSkins.ts`:

| Type | rim | liner | pool | Type | rim | liner | pool |
|---|---|---|---|---|---|---|---|
| Normal | `#a8a77a` | ink | `#717156` | Ground | `#e2bf65` | ink | `#978149` |
| Fire | `#ee8130` | ink | `#9f5926` | Flying | `#a98ff3` | ink | `#7262a5` |
| Water | `#6390f0` | ink | `#4463a3` | Psychic | `#f95587` | ink | `#a63c5f` |
| Electric | `#f7d02c` | ink | `#a48c24` | Bug | `#a6b91a` | ink | `#707d18` |
| Grass | `#7ac74c` | ink | `#538638` | Rock | `#b6a136` | ink | `#7a6e2a` |
| Ice | `#96d9d6` | ink | `#659292` | Steel | `#b7b7ce` | ink | `#7b7c8d` |
| **Fighting** | `#c22e28` | **bone** | `#d16962` | **Ghost** | `#735797` | **bone** | `#9a85af` |
| **Poison** | `#a33ea1` | **bone** | `#bc74b6` | **Dragon** | `#6f35fc` | **bone** | `#976df6` |
| Fairy | `#d685ad` | ink | `#8f5b77` | **Dark** | `#705746` | **bone** | `#988577` |

### 2.5 How it survives a 40 px square

Concrete pixel budget at the mobile floor (cell = 40 px):

```
ink halo         1px
bezel            2px   ← the silhouette. A 2px stroke describing a 26px outline is unambiguous.
liner            1px
enamel field    26px   ← pool→rim radial
sprite          ~23×22 opaque (measured median), drawn at 1.0× native, offset up 2px
crest glyph      8×8 in the top-left corner (91% of icons leave it empty — measured)
pin diameter    26px (pawn) → 37px (king, overflowing the cell top by 2px)
```

Six 26–37 px silhouettes differing in symmetry class is a far easier discrimination task than six 10 px
font glyphs. Verify it the cheap way: **render the board at 40 px, screenshot it, downscale to 50%, convert
to greyscale, and check you can still name every role.** That test should be in the repo as a visual
regression fixture. If a silhouette fails it, the silhouette is wrong — not the test.

### 2.6 How it survives colour blindness

Role never touches colour. Army is a 15.2:1 luminance difference, which is invariant under all three
dichromacies. Type is the only colour-coded channel, and it gets the 18-glyph second channel (§7.1) plus
the always-available type name in the inspector. Finding 4's seven deuteranopic collisions
(Poison/Ghost, Fire/Bug, …) are resolved entirely by the glyph, not by shifting the fixed hexes.

### 2.7 Alternatives considered and rejected

| Option | Verdict |
|---|---|
| Unicode chess glyphs as primary | **Reject.** Indistinguishable ≤12 px; font/emoji-presentation fragility already documented in the codebase. Keep them only in the legend and in text. |
| Pedestal / plinth under the sprite | **Reject as primary.** Finding 6: the bottom 6 rows of an icon cell are non-empty in 99% of icons, so a plinth either overlaps the art or forces a taller cell. Fold it into the bezel's bottom arc instead. |
| Size hierarchy alone | **Reject as primary, keep as secondary.** Six tiers exist in the recommendation (66→92%), but size is unreliable for non-adjacent comparison. |
| Frame weight / ring thickness | **Reject.** Sub-pixel at 40 px. |
| Corner pips (1–6 dots for value) | **Reject.** Counting is slow, and 5 vs 6 pips at 8 px is a coin flip. |
| Replace sprites with chess figurines | **Reject.** The Pokémon *is* the point. |
| Notation mode (letter replaces sprite) | **Adopt as an option**, not a default. See §7.4 — it is genuinely the fastest board for a strong chess player and it costs almost nothing. |

---

## 3. The board and the stage

```
--sq-dark  #5C6575    --sq-light #818A9B    checker ratio 1.69:1
```

- **Surface.** Honed slate: a flat fill plus a **very** low-amplitude noise (a 128×128 tiling PNG, ±3 L\*,
  ~1.4 KB, `background-blend-mode: overlay`, opacity 0.5). Enough that the slab is not a flat vector plane;
  not enough to compete with a pin. No wood, no marble veining, no gradient per square.
- **Grid.** A 1 px `--sq-inlay` (`rgba(11,14,20,.34)`) line between every square — the inlay, not the
  lightness difference, is what makes the checker read. This is why the checker ratio can stay at a quiet
  1.69 while both armies still clear 3:1.
- **Frame.** A 2 px `--brass` bezel around the whole slab with a 1 px `--ink` line inside and outside it.
  Purely structural. It is also the surface that turns gold while an extra move is unspent (§4.1).
- **Coordinates.** `--t-label` in `--text-3`, files along the bottom outside the frame, ranks up the left.
  Outside, always, never overlaid on a square.
- **Square states** (all on layer L1, beneath pins):

| State | Treatment |
|---|---|
| selected | 2 px `--army-*` bracket at the four corners (a reticle, not a full ring) |
| legal move | a 22%-diameter `--bone` dot at 55% opacity, centred |
| legal capture — neutral | 2 px `--bone` ring inset 3 px |
| legal capture — super effective | 2 px `--gold` ring + 1 px `--ink` outside it, plus a `▲` at the square's top-right |
| legal capture — not very effective | 2 px `--bone` ring drawn **dashed 4-3**, plus a `⇄` mark |
| illegal — no effect | a `--ward` hexagon outline at 60%, plus `⊘`. Never a red X. |
| last move | the origin and destination squares get a 1 px `--brass` inset ring, held until the next move |
| threatened (threat overlay on) | a 3 px `--ink` triangle in the square's bottom-left corner |
| hazard present | an inlaid decal, §5.4 |

Note the pattern: **every board state has a mark as well as a colour.** No square state is colour-only.

- **The stage.** The page is `--stage`; the slab sits centred with a soft radial pool of light behind it
  (`radial-gradient(ellipse 120% 80% at 50% 40%, rgba(200,215,240,.07), transparent 70%)`). Rails sit in
  shadow. It should look like a lit table in a dark hall.

---

## 4. The four capture outcomes

**Governing principle, from finding 3: outcomes are encoded by FORM, DIRECTION, SYMMETRY and COUNT.
Colour is decoration.** Measured, the natural outcome hues are within ΔE 12–19 of a type colour and two of
them merge under protanopia, so a player who reads outcomes by colour will read them wrong.

The four consequences and their orthogonal encodings:

| Outcome | Form | Direction | Symmetry | Deaths | Attacker ends |
|---|---|---|---|---|---|
| **ADVANTAGE** super effective | 8-ray **star** | outward + up | 8-fold radial | 1 | on the target square, ringed gold |
| **TRADE** neutral | single **slash** | inward along the move vector | none | 1 | on the target square |
| **BACKLASH** not very effective | **twin cracks** | apart, perpendicular | 2-fold mirror | **2** | gone |
| **BLOCKED** no effect | **hexagon** ward | inward then **reversed** | 6-fold | **0** | back on its origin square |

Four different shapes, four different motion directions, four different death counts. Any one of the four
alone identifies the outcome. In greyscale, at 40 px, with sound off, on a still frame.

**Layer stack** used throughout (define once, in `src/ui/layers.ts`):

```
L0 board-inlay   squares, brass frame, coordinates                     (DOM)
L1 square-state  hazards, terrain, dots, rings, last-move, threat      (DOM/SVG)
L2 pieces        pins, absolutely positioned, transform-driven ONLY    (DOM)
L3 pin-overlay   status marks, tethers, ward hexes, extra-move ring    (SVG, follows the pin transform)
L4 fx            particles, bursts, beams, shatters, dice              (one <canvas>, 2D)
L5 weather       full-board sky wash                                   (<canvas> at 0.5× res, 30fps)
L6 stage         dim, vignette, promotion spotlight                    (DOM)
L7 hud           panels, banners, toasts, the dice tray                (DOM)
```

### 4.1 ADVANTAGE — super effective, capture plus a free extra move

**The single most consequential event in the game.** It gets the biggest beat, and — critically — the beat
does not end. It leaves a **persistent state** on screen until the extra move is spent. A flourish can be
missed; a board that stays visibly different cannot.

| t (ms) | Layer | What happens | Duration | Easing |
|---|---|---|---|---|
| 0 | L2 | **Lift.** Attacker `scale 1→1.10`, `translateY -6%`, e2→e3 | 120 | `--ease-out-quart` |
| 120 | L2 | **Travel** along the move vector to the target square | `90 + 26·chebyshev` (116–272) | `--ease-in-out-quint` |
| 120 | L1 | A 2 px type-coloured **trail** is stamped along the path, decaying | 400 | linear |
| T | L4 | **Impact flash.** `--gold-hot` fill on the target square at 0.9α, 1 frame, then out | 16 + 90 | `--ease-in-quad` |
| T | L0 | **Board punch.** Whole slab `translate ±2px`, 3 cycles | 90 | `steps` |
| T+16 | L2 | **Defender dies.** `scale 1→1.14→0`, `opacity→0` | 180 | `--ease-in-quad` |
| T+16 | L4 | Its enamel breaks into **6 wedge shards**, tinted the *defender's* type colour, flung 40–70 px with gravity | 420 | ballistic |
| T+40 | L4 | **THE STAR.** 8 rays along the compass, `--gold` with a `--gold-hot` core, `scale 0→1.6`, `opacity 1→0` | 320 | `--ease-out-quart` |
| T+40 | L6 | **Stage dims** to `rgba(8,10,14,.45)`, punching out only the attacker's square | 160 | `--ease-out-quart` |
| T+120 | L3 | **SECOND WIND.** A 2 px `--gold` ring (+1 px `--ink` outside) appears at 118% of the pin's silhouette, drawn as a `stroke-dasharray` sweep 0→100% | 260 | `--ease-out-quart` |
| T+380 | L3 | That ring **breathes** — `scale 1.0↔1.035` — and does not stop until the move is spent | 1400 loop | `--ease-in-out-sine` |
| T+180 | L7 | **HUD splits.** `WHITE · MOVE 1` slides left; a new chip `+ EXTRA MOVE` snaps in from the right with overshoot, gold underline sweep | 220 | `--ease-out-back` |
| T+180 | a11y | `aria-live="assertive"` announcement fires (§7.3) | — | — |
| T+300 | L1 | **Destinations bloom.** Every legal square for the free move gets a gold dot, staggered **18 ms** in Chebyshev-distance order from the attacker, so the reveal radiates outward | 260 + stagger | `--ease-out-back` |
| T+560 | L6 | Dim **releases to `rgba(8,10,14,.18)` and holds** | 200 | linear |
| T+560 | L0 | The slab's brass frame turns **`--gold`, 2 px**, and holds | 200 | linear |
| — | — | Interactive from **T+16**. The dim, star and dots are all cosmetic; a click at any moment commits. | | |

**The four persistent tells** that survive skip, reduced motion, sound off and a distracted player:
1. the gold ring around the pin that owes a move,
2. the board's frame is gold,
3. the stage is 18% dimmer than normal,
4. the HUD shows two turn chips instead of one.

Nothing is a one-shot animation. That is the design.

**Sound intent** (wordless): a bright metallic **chime** on impact — 4 ms attack, 180 ms decay, fundamental
≈1.6 kHz with the third harmonic emphasised — layered on a 60 Hz thud. Then a **rising perfect fifth** as
the ring draws. Then, while the extra move is unspent, a soft **metronome tick at 92 bpm**: an unresolved
rhythm that stops the instant you move. Ticking is the audio form of "you still owe a move." With sound
off, the breathing ring does that job.

### 4.2 TRADE — neutral

Reads by **absence**. Nothing radial, nothing gold, no shards, no dim, no HUD change.

| t | Layer | What | Duration | Easing |
|---|---|---|---|---|
| 0 | L2 | Lift (same as above but `scale 1.06`, no `translateY`) | 90 | `--ease-out-quart` |
| 90 | L2 | Travel | `70 + 22·chebyshev` | `--ease-in-out-quint` |
| T | L4 | **One slash**: a 3 px `--bone` stroke across the target square, *along the move vector*, drawn then wiped | 110 | `--ease-out-quart` |
| T | L4 | Single-frame white flash at 0.55α | 16 + 60 | linear |
| T+10 | L2 | Defender `scale 1→0.86→0`, `opacity→0` | 160 | `--ease-in-quad` |
| T+10 | L4 | **8 dust motes** only. No shards, no star. | 260 | ballistic |
| T+140 | L2 | Attacker settles: 3% squash then release | 80 | `--ease-out-back` |

Total 320 ms. Sound: a single dull **knock** — low, damped, 90 ms, no tail. The most common outcome must be
the cheapest and quietest, or the game becomes exhausting. This is the baseline everything else is read
against.

### 4.3 BACKLASH — not very effective, both pieces destroyed

Reads by **two-fold mirror symmetry and a death count of two**. That is the encoding; the colour is grey.

| t | Layer | What | Duration | Easing |
|---|---|---|---|---|
| 0–T | L2 | Lift + travel, as TRADE | | |
| T | L4 | Impact flash at 0.7α | 16 + 70 | linear |
| T | L0 | **Grinding shudder** — 6 cycles at ±1 px (vs ADVANTAGE's 3 at ±2). Twice the count, half the amplitude. | 150 | `steps` |
| T+30 | L3 | **Twin cracks.** An identical top-left→bottom-right fracture path, 2 px `--bone`, drawn 0→100% on **both** pins simultaneously | 90 | linear |
| T+130 | L2 | **Each pin splits.** Both halves slide apart perpendicular to the crack, rotate ±14°, fall 30 px with gravity, desaturate to `--ash` | 240 | `--ease-in-quad` |
| T+130 | L4 | 4 shards per pin, tinted each pin's *own* type colour — so the player can see *which two types* traded | 380 | ballistic |
| T+370 | L1 | Both squares get an **ash decal** at 40%, fading out | 900 | `--ease-out-quart` |
| T+370 | L7 | Both pins drop into their owners' trays, tarnished (desaturate 100%, brightness 0.7) | 240 | `--ease-out-quart` |

Total 500 ms. Sound: **crack–crack**, two hits 60 ms apart — you *hear* two deaths — then a descending
filtered-noise sweep. The doubling in both the visual count and the audio count is the whole idea.

Under the `Backlash` variants the ruleset may choose (attacker demoted / statused / bounced instead of
killed, per `recon-variants.md` §6.3), the animation degrades gracefully: the attacker's crack **draws and
then heals** (the stroke retracts over 180 ms) and the relevant status mark flies to its collar. Same
symmetry, one survivor. Legible as "it nearly took me with it."

### 4.4 BLOCKED — no effect, the capture is illegal

Two tiers, because the best rejection is one that never happens.

**Tier 1 — prevention (the default path).** An illegal capture is never offered. Selecting an attacker
draws a `--ward` hexagon outline plus `⊘` on every square its type cannot touch; hovering states
`Ground has no effect on Flying` in the inspector. The normal experience is **education, not failure**, and
this is also how the type chart gets taught (§8.3).

**Tier 2 — rejection (forced: keyboard commit, an AI probe, or a ward that only reveals on contact).**

| t | Layer | What | Duration | Easing |
|---|---|---|---|---|
| 0 | L2 | Lift | 100 | `--ease-out-quart` |
| 100 | L2 | Travel **40% of the way only** | 110 | `--ease-out-quart` |
| 210 | L3 | **The ward.** A 6-sided `--ward` ring, 2 px, appears on the defender's square edge: `scale .9→1`, `opacity 0→1` | 70 | `--ease-out-quart` |
| 240 | L3 | A second hexagon **ripples** outward to `scale 1.4`, fading | 240 | `--ease-out-quart` |
| 240 | L2 | **Travel reverses.** Attacker returns to its origin square, overshooting 4% past it, then settles | 180 | `--ease-in-out-quint` |
| 240 | L2 | Attacker desaturates to 60% ("stunned"), then recovers | 200 | linear |
| 240 | L4 | 6 `--ward` motes puff at the contact point and die | 200 | ballistic |
| 420 | L7 | A toast: `No effect — Ground cannot capture Flying`. Cursor shows `not-allowed`. | 2400 hold | — |

Total 480 ms. **Nothing dies, and the attacker ends where it began** — it is the only outcome with either
property, and motion reversal is universally read as rejection. Sound: a **dry damped thunk** (40 ms,
heavily damped, no tail — the sonic definition of "blocked") plus a small glass *tink* on the ward.

When the block came from a one-shot ward (Air Balloon, Levitate, a `WARD` ability — see
`recon-abilities-items.md` §6.1) the ward hexagon then **shatters** into 6 segments over 200 ms, and the
defender's pin gains a small broken-hexagon mark on its collar. The player learns "the shield broke" and
that the square is now attackable, from one animation, with no text.

---

## 5. RNG: the die and the coin

Two instruments, two meanings, learnable in one game. They differ in silhouette, rotation axis and material,
so they are never confused:

| | **The Tempo Die** | **The Clash Die** | **The Coin** |
|---|---|---|---|
| Form | cube, 40 px | cube, 22 px | disc, 20 px |
| Material | ink pips on bone | ink pips on bone (`6` → gold, `1` → chalk) | brass, a Poké Ball face on heads |
| Motion | tumbles `rotate3d`, 3 turns, lands flat | slams down, `scale 1.6→1`, `rotate -8°→0` | spins **on its edge**, `rotateY 0→1080°` |
| Where | right rail, at turn start | on the target square, at impact | on the affected square, after impact |
| Means | the turn's public random state | the capture roll | did a rider effect land |
| Duration | 900 ms | 110 ms + 500 ms hold | 300 ms |

### 5.1 The Tempo Die — input randomness made board-visible

`recon-variants.md` §6.3 is emphatic that the roll must come **before** the decision, and recommends
revealing a public per-turn CRIT type and FLINCH type. That is not just a rules choice, it is the better
*visual* too, because it lets the randomness change the board rather than interrupt it.

At the start of each turn the 40 px die tumbles in the right rail (900 ms, `--ease-out-quart`, three
`rotate3d` turns with a 2-bounce landing), lands, and two chips slide out of it:

```
  ┌─────────────────────────────────┐
  │  ┌────┐                         │
  │  │ ⚄  │   CRIT   ▲  ◈ WATER     │   every Water pin gains a gold hairline + sheen
  │  └────┘   FLINCH ▼  ◈ GRASS     │   every Grass pin desaturates 45% + gets a padlock
  └─────────────────────────────────┘
```

Then the board reacts, staggered **24 ms per pin in reading order**: CRIT-type pins gain a 1 px gold
hairline outside the bezel and a single 600 ms sheen sweep; FLINCH-type pins desaturate 45% and take a small
`--ink` padlock on the bezel's bottom arc. This happens during the opponent's think time, so it costs zero
tempo, and it makes the roll something you *plan around* rather than something that happens to you.

### 5.2 The Clash Die — the cause stamp

The die does **not** open a modal and does not block. At the moment of impact a 22 px die face slams onto
the target square (`scale 1.6→1`, `rotate -8°→0`, 110 ms `--ease-out-back`), holds 500 ms, fades 180 ms.
Then the consequence animation runs.

This is the key structural idea: **causes and consequences are orthogonal.**

- **Cause markers** say *why*: the type chip (`◈ FIRE ▲ ×2 vs GRASS`) or the die face.
- **Consequence forms** say *what*: the four animations of §4.

So a **6 / crit** does not need a fifth animation — it plays **ADVANTAGE** with two differences: the star's
core is `--crit #FF7A45` instead of white, and the die-6 face is stamped at the star's centre for 500 ms.
The player learns "same reward, different cause", which is exactly the rule. And a **1 / miss** plays
whichever consequence the ruleset assigns (the BLOCKED reversal with a dust puff and no ward hexagon if a
miss spares both pieces; BACKLASH if the video's rule survives) with the `1` face stamped as the cause.

Distinguishing the die faces at 22 px: use **pip layouts, not numerals**, and give the two extremes their
own material — `6` is ink pips on `--gold` with a hot rim, `1` is a single ink pip on chalk-white with a
hairline crack across the face. The two faces that matter are the two that look different from all others.

### 5.3 The Coin — TCG-authentic rider resolution

`DIRECTION.md` legitimises the TCG's coin flip explicitly. Use it for binary rider effects — does the
status land, does the flinch land, does Quick Claw fire. A 20 px brass coin appears over the affected
square, spins edge-on (`rotateY 0→1080°`, 300 ms `--ease-out-quart`, with a 1 px specular band sweeping the
edge), and lands:

- **Heads** (a Poké Ball face): the rider fires. Its status mark flies from the coin onto the pin's collar
  along a 140 ms arc, and the collar pulses once.
- **Tails** (blank ink): the coin dissolves into 4 dust motes over 160 ms.

Sound: a metallic ping on the flip, a small clink on the landing. Two flips (a 50% + 50% rider) means two
coins side by side, flipped with a 90 ms stagger — because in the TCG you can see how many coins you flip,
and count is information.

---

## 6. Move, ability and item visual identity

### 6.1 The composition rule — the VFX record *is* the rules record

950 moves cannot be hand-animated, and they do not need to be, because `recon-moves.md` §2.1 already
derives an orthogonal facet record per move (`shape`, `payload`, `selfAfter`, `power`, `reach`,
`duration`). **Reuse it verbatim as the VFX record.** No per-move VFX table exists; a move's visuals are a
pure function of the facets the rules engine already computed.

```
visual(move) = EMITTER[shape]  ×  RESOLVER[payload]  ×  SKIN[type]
               × MODIFIER[selfAfter]  × intensity(power)  × count(multihit)
```

Authored art total: **12 emitters + 12 resolvers + 8 particle primitives + 4 noise profiles + 18 type
glyphs = 54 assets.** Every one of the 950 moves composes from them, and the 37 non-empty
`shape × payload` cells that `recon-moves.md` measured are exactly the 37 combinations that will ever be
seen — so 37 combinations can be reviewed by eye before ship.

### 6.2 The 12 emitters — *where* (from `shape`)

| Shape | n (all-gens) | Emitter | Geometry drawn |
|---|---|---|---|
| `MELEE` | 641 | **Lunge** | pin travels in, impacts, returns or occupies. The default; carries 2/3 of the dex. |
| `RAY_LOS` | 44 | **Beam** | a 5 px type-coloured shaft from caster to the first occupied square on the ray, drawn 0→100% in 140 ms, with a muzzle flare at the origin and a bloom at the hit. Blockers stop it visibly — the beam *stops short*. |
| `RAY_ANY` | 24 | **Arc** | a quadratic bezier that rises **over** intervening pins (peak 40% of the span) and lands. It visibly ignores blockers, which is the rule. |
| `RING1_ALL` | 20 | **Shockring** | a ring expanding from the caster through all 8 neighbours, `scale 0→1`, 220 ms, plus a per-square impact — **including friendly squares**, which flash the same way. Friendly fire must look identical or the rule is hidden. |
| `RING1_FOES` | 62 | **Sweep** | the same ring, but it *skips* friendly squares — a visible gap. The difference between the two is the gap, and the gap is the mechanic. |
| `BOARD` | 24 | **Wash** | a wavefront crossing the entire slab from the caster's rank, 420 ms, then the board's persistent state changes (§6.5). |
| `OWN_ARMY` | 16 | **Aegis** | a translucent pane rises over the caster's half of the board (`scaleY 0→1` from that side's edge), 300 ms, and persists as a faint tint with a corner turn-counter. |
| `ENEMY_ZONE` | 4 | **Paint** | three squares of the enemy rank are stamped with the hazard decal, 90 ms each, staggered 60 ms. |
| `SELF` | 99 | **Aura** | a ring closes *inward* onto the caster (the reverse of Shockring — inward means self), plus a rising particle column. |
| `ALLY` | 10 | **Tether** | a 2 px animated dashed line caster→ally, drawn 160 ms, then a pulse travels along it and the ally's collar flashes. |
| `RANDOM_FOE` | 6 | **Seek** | the aim reticle skitters between 3–4 candidate squares (70 ms each) before locking. The visible indecision *is* the randomness. |
| `REACTIVE` | 4 | **Mirror** | on the *opponent's* attack: a mirror plane flips up on the caster's square and the incoming effect is drawn again, reversed, going back. |

### 6.3 The 12 resolvers — *what happens* (from `payload`)

| Payload | Resolver | Drawn |
|---|---|---|
| `DAMAGE` | **Impact** | the §4 outcome animation. This is the only resolver that can kill. |
| `BUFF` | **Rise** | 3 chevrons rise off the pin and dissolve; the bezel gains a `+n` notch on its top arc |
| `DEBUFF` | **Sink** | 3 chevrons sink into the square; a `−n` notch on the bottom arc |
| `VOLATILE` | **Orbit** | a small mark enters orbit around the pin, 3.2 s period, and stays as long as the effect does |
| `STATUS` | **Brand** | the status mark is stamped onto the collar with a 1-frame flash and a 90 ms settle |
| `RESTORE` | **Inhale** | particles spiral *inward* onto the pin and vanish; a soft bloom |
| `ZONE` | **Stamp** | a hazard decal is inlaid into the square with a 60 ms press |
| `FIELD` | **Grade** | the whole board's tones shift (§6.5) |
| `OHKO` | **Guillotine** | one hard vertical line falls through the square in 80 ms. Deliberately the shortest, coldest effect in the game. |
| `WITHDRAW` | **Retrace** | after resolving, the pin travels back along its own trail, which is redrawn brighter as it goes |
| `DISPLACE` | **Shove** | the target is pushed one square with a 40 ms anticipation and an 8% squash on the leading edge |
| `OTHER` (ENCOURAGE fallback) | **Shrug** | one soft rising mote and a single `+` notch. Deliberately minor. Splash and Celebrate land here and *should*. |

### 6.4 The 18 type skins — *how it looks* (from the piece's type)

Each type is `{hex, particle, noise, blend, extra}`. Only **8 particle primitives** (an 8×8 sprite atlas,
one `drawImage` per particle, no per-particle gradients — that is what costs frames) and **4 noise
profiles** are authored.

Primitives: `SPARK` (a 3 px tapered streak) · `DROPLET` · `MOTE` (a soft 4 px dot) · `SHARD` (an angular
triangle) · `WISP` (a 6 px smear, no gravity) · `PETAL` · `RING` · `DUST`.
Noise: `STRAIGHT` (no lateral) · `TURBULENT` (curl noise, amp 0.4) · `DRIFT` (slow sine, amp 0.15) ·
`CRACKLE` (a polyline that re-forks every 60 ms).

| Type | particle | noise | blend | extra |
|---|---|---|---|---|
| Normal | MOTE | STRAIGHT | normal | — |
| Fire | SPARK | TURBULENT | screen | heat shimmer on the target square, 180 ms |
| Water | DROPLET | DRIFT | screen | a splash ring on impact |
| Electric | SPARK | CRACKLE | screen | a polyline bolt caster→target, reforking |
| Grass | PETAL | DRIFT | normal | leaves settle on the square for 400 ms |
| Ice | SHARD | STRAIGHT | screen | a frost decal that crazes outward |
| Fighting | DUST | STRAIGHT | normal | a hard impact ring, no particles until after |
| Poison | DROPLET | DRIFT | multiply | bubbles that rise and pop |
| Ground | DUST | TURBULENT | normal | the square's inlay cracks for 300 ms |
| Flying | WISP | DRIFT | normal | 3 feather streaks along the arc |
| Psychic | RING | DRIFT | screen | 3 concentric rings, phase-offset |
| Bug | MOTE | TURBULENT | normal | motes swarm before dispersing |
| Rock | SHARD | STRAIGHT | normal | 2× gravity, shards bounce once |
| Ghost | WISP | DRIFT | screen | zero gravity, a 4-frame trailing smear |
| Dragon | RING | STRAIGHT | screen | rings spiral along the travel axis |
| Dark | WISP | TURBULENT | multiply | the square darkens 20% for 240 ms |
| Steel | SHARD | STRAIGHT | normal | a hard specular glint, 1 frame |
| Fairy | PETAL | DRIFT | screen | 4-point twinkles that pop in sequence |

`intensity(power)`: T1 → 0.6× particle count and scale; T2 0.8×; T3 1.0×; T4 1.25×; T5 1.6× plus one extra
board-punch cycle. `count(multihit)`: n staccato repeats at 90 ms intervals, each at 0.7× intensity, with
the last at 1.2× — so a 5-hit move reads as five hits and lands hard.

`MODIFIER[selfAfter]`: `DRAIN` → the target's particles reverse and land on the caster. `RECOIL` → the
caster takes a 90 ms kickback and a 2-shard puff. `CHARGE` → turn 1 the pin lifts to e3 and holds with a
1.6 s breathing loop and a `◷` mark (Fly/Dig actually leave the square: the pin fades to 15% and the square
shows a shadow). `RECHARGE` → a smoke plume and the pin's bezel greys for one turn. `PRE_EMPT` → three
speed lines behind the pin during travel and a 40 ms head start.

### 6.5 Marquee treatments

**Hazards visibly sitting on squares** (L1, beneath pins, so they are never occluded by a pin's silhouette
alone). Each hazard is an **inlaid decal** — drawn at 55% opacity with a 1 px `--ink` outline so it reads on
both square tones — plus **layer pips** in the square's top-right corner.

| Hazard | Decal | Layers |
|---|---|---|
| Spikes | 3 caltrop marks; 1 / 2 / 3 marks appear as layers stack | 3 |
| Toxic Spikes | 2 bubbling purple blots that slowly pulse (2.8 s) | 2 |
| Stealth Rock | a floating shard with a cast shadow, drifting 2 px | 1 |
| Sticky Web | a corner-to-corner web whose strands sag 1 px on a 3 s loop | 1 |

Triggering: when an enemy pin ends a move on a hazard square, the decal flashes to 100% and its particles
fire *upward into the pin* (140 ms), then the decal decrements a pip. Nothing about a hazard is hidden.

**Status visibly afflicting a piece.** Three simultaneous channels: a **collar mark** (10×10 SVG clipped
into the bezel's bottom-right notch), a **bezel tint**, and a **motion tell**. The motion tell matters most,
because it is visible in peripheral vision:

| Status | Collar | Bezel | Motion tell |
|---|---|---|---|
| `par` | a zigzag | yellow inner liner | a 1 px jitter every 2 s, 60 ms |
| `slp` | closed eyes + `z` | blue-grey wash, 15% desaturate | slow breathing, `scale 1.0↔1.02`, 2.2 s |
| `brn` | a flame notch | orange top arc | a 1 px heat shimmer on the bezel's top edge, continuous |
| `psn` | a bubble | purple inner liner | a slow purple pulse, 2.6 s |
| `tox` | a bubble + a counter | purple liner, brighter each turn | pulse period shortens 2.6 → 0.9 s as the counter climbs — **the piece visibly runs out of time** |
| `frz` | a crystal | frost overlay on the enamel | **all idle motion stops.** Absence of motion, on a board where everything breathes, is the loudest possible signal. |
| `flinch` (1 turn) | — | — | the pin greys to 55% and a `⊘` sits on its collar until its turn passes |

**Weather and terrain changing the whole board.** They occupy different physical layers so they compose
without ambiguity: **weather is a sky (L5, above the pins); terrain is a floor (L1, in the squares).**

| Field | Layer | Treatment |
|---|---|---|
| Rain | L5 | 60 streaks at 12% opacity falling at 18°; square tones shift −4% L and +3° toward blue |
| Sun | L5 | a warm bloom from the top-right at 10%; square tones +5% L, +4° toward amber; pins gain a warmer rim light |
| Sand | L5 | a drifting grain field at 9% + a `sepia(0.12)` grade on L0–L2; visibility of distant squares softens |
| Snow/Hail | L5 | slow drifting motes at 11%; squares +3% L, −5° toward cyan; a 1 px frost line on each square's top edge |
| Electric Terrain | L1 | thin cyan grid lines inside each square's inlay, pulsing along one axis every 3 s |
| Grassy Terrain | L1 | a green fringe grows 2 px inward from each square's edge |
| Misty Terrain | L1 | a soft white bloom in each square's centre at 8% |
| Psychic Terrain | L1 | a faint hex tessellation across the squares, rotating 1°/s |

The transition is the Wash emitter (§6.2): a wavefront crosses the slab in 420 ms and the persistent state
is *behind* it. Both weather and terrain show a turn counter as pips on the board frame — weather on the
top edge, terrain on the bottom edge. Two states, two locations, no ambiguity.

**A trapped piece visibly held.** The tether is the point: it names *who* is doing it.
- A 2 px chain (or roots, or web, per the trapping move's type skin) is drawn on L3 from the trapper to the
  trapped pin, with 5 links, and it **stretches and snaps taut** whenever the player hovers a square the
  trapped piece cannot reach (140 ms, `--ease-out-back`, plus a 90 ms shudder on the trapped pin).
- The trapped pin gains a shackle mark on its bezel's bottom arc and a turn counter.
- Its legal-move dots simply do not appear for the squares it cannot leave to. The absence is the rule.
- On escape or expiry the chain **breaks at the midpoint** and both halves recoil to their ends (200 ms).

**An evolving pawn.** The second-biggest moment in the game after the extra move, and it must communicate
*two* things: a new Pokémon **and** a new chess role.

| t (ms) | What | Layer |
|---|---|---|
| 0 | Board dims to 25%; a spotlight ellipse opens on the promoting square (280 ms, `--ease-out-quart`) | L6 |
| 280 | The pin **lifts off the board** to `scale 1.5`, centred over its square, e3→e4 shadow | L2 |
| 420 | The sprite goes to a **solid `--bone` silhouette** — the canonical Pokémon evolution cue | L2 |
| 520 | **The flicker.** The silhouette alternates old species ↔ new species **6 times over 1100 ms at accelerating frequency** (280, 240, 200, 160, 120, 100 ms), each flip `scale 1.0→1.06→1.0` | L2 |
| 1620 | **Flash out**: `--gold-hot` fills the spotlight for 2 frames, then blows out over 160 ms | L4/L6 |
| 1780 | **The landing.** The new pin descends into the square with its **new silhouette** (circle → crowned octagon), `scale 1.5→1.0`, `--ease-out-back`, and a ring of the new type colour expands once | L2/L4 |
| 1900 | Spotlight closes, dim releases. If the type changed (Charizard-Mega-X gaining Dragon), the type chip in the HUD flips like a card and the enamel cross-fades over 240 ms. | L6 |

Total 1900 ms, skippable at any point (skip jumps to t=1780). Sound: the canonical rising evolution motif —
a two-note ostinato accelerating with the flicker, resolving up a major third on the landing.

### 6.6 Abilities and items on the pin

`recon-abilities-items.md` §4.4 sets the legibility budget at **13 ability glyphs + 12 item glyphs = 25
symbols**, and archetype colour is the UI. Adopt it exactly, and place it:

- **At cell ≥64 px:** two 10 px glyphs sit in the bezel's bottom arc — the ability archetype glyph on the
  left, the item class glyph on the right, each tinted with its archetype's own colour from a 13-value
  ramp that is deliberately **low chroma** (C\* ≤ 22) so it cannot be mistaken for a type colour.
- **At cell <64 px:** they collapse into a single `▪` presence dot; the detail lives in the inspector.
- **When either fires**, its glyph pulses `scale 1→1.5→1` over 220 ms and a one-line HUD log entry names it.
  A hook that fires and is not visible is a rules bug in disguise.
- **When an item is consumed**, the item glyph shatters into 4 pieces and the socket goes empty and recessed
  — the same visual grammar as the ward breaking, because it is the same idea.

---

## 7. Motion system

### 7.1 Scales

```css
:root {
  /* durations — multiplied at runtime by --fx-scale (0.5 / 1 / 2 / 0) */
  --d-instant:   90ms;   /* state flips, hovers, focus */
  --d-quick:    140ms;   /* chips, dots, toggles */
  --d-base:     220ms;   /* the default. Panels, cards, most reveals. */
  --d-slow:     340ms;   /* travel, bursts */
  --d-beat:     520ms;   /* one whole capture resolution */
  --d-event:    900ms;   /* tempo die, board field change */
  --d-cine:    1900ms;   /* promotion only */

  --ease-out-quart:    cubic-bezier(0.165, 0.84, 0.44, 1);   /* reveals, arrivals */
  --ease-in-out-quint: cubic-bezier(0.86, 0, 0.07, 1);       /* piece travel — slow ends, fast middle */
  --ease-out-back:     cubic-bezier(0.34, 1.56, 0.64, 1);    /* landings, overshoot */
  --ease-in-quad:      cubic-bezier(0.55, 0.085, 0.68, 0.53);/* departures, deaths */
  --ease-in-out-sine:  cubic-bezier(0.37, 0, 0.63, 1);       /* breathing loops */
}
```

Rules: **only `transform` and `opacity` animate in Lane A.** Never `box-shadow`, `filter`, `background`,
`width`, `top/left`. Glows are pre-rendered radial-gradient elements scaled by transform. `will-change:
transform` is set only on the pin that is currently acting, and removed on completion.

**Stagger** is always distance-ordered, never index-ordered — reveals should radiate from the thing that
caused them:
- legal-move dots: 18 ms per Chebyshev ring from the selected pin
- board-wide effects: 24 ms per file from the caster's file
- tray entries: 40 ms per pin
- HUD list items: 30 ms, capped at 8 items then instant

### 7.2 Lanes, queueing and interruption

**The architectural statement that makes all of this safe:** the rules engine is pure, deterministic and
emits an event log (`BRIEF.md` §4.2). **Animation is a projection of an already-resolved event log. Game
state never waits for a frame.** Every animation below is a replay of something that has already happened,
which is why nothing can block input and why skipping can never desync.

| Lane | Contents | Policy |
|---|---|---|
| **A — Board** | pin travel, capture resolution, promotion, field changes, hazard triggers | **Strictly queued, one at a time**, in engine event order. Never dropped. |
| **B — Ambient** | idle breathing, weather, terrain, hazard shimmer, status tells, the extra-move ring | **Always overlapping, never queued, never blocking.** Runs forever. |
| **C — HUD** | log lines, chips, banners, dice, toasts | **Overlapping**, may run concurrently with Lane A. |

Interruption model — one rule, and it is not "cancel":

> **Any player input fast-forwards Lane A to completion.** Every queued animation snaps to its final frame
> instantly (in order), then the input applies. Nothing is cancelled mid-way, so no visual state is ever
> left half-applied and no `onComplete` is ever skipped.

Consequences: a player who clicks fast never waits and never sees a stuck piece; a player who watches gets
the full show; the two paths converge on the same DOM. Implement it as a single
`fx.flush()` called at the top of every input handler.

### 7.3 Speed control, skip, and reduced motion

Three controls, in the right rail, always visible, never buried in a settings modal:

| Control | Values | Effect |
|---|---|---|
| **Speed** | `0.5× · 1× · 2× · Off` | Sets `--fx-scale`. `Off` renders only final states with a 90 ms crossfade. |
| **Skip** | a button, and the `Space` key | `fx.flush()`. Also skips the promotion cinematic. |
| **Effects** | `Full · Essential · Off` | See below. |

`prefers-reduced-motion: reduce` **defaults to `Essential`** (and says so, once, in a dismissible line —
never silently). It does not mean "no feedback":

| | Full | Essential | Off |
|---|---|---|---|
| pin travel | tweened | **instant cut** | instant cut |
| board punch / shudder | yes | **no** | no |
| particles | yes | **no** | no |
| breathing loops | yes | **no** — replaced by a static 2 px ring | static ring |
| impact flash | 1 frame | **a 220 ms opacity crossfade** | crossfade |
| **outcome identity** | animated form | **a static stamp held 1200 ms** | static stamp held 1200 ms |
| persistent state (gold ring, gold frame, dim, hazard decals, status marks) | yes | **yes** | **yes** |

The static stamps are the reason §4's forms were designed as distinguishable *silhouettes*: `✳` star,
`╱` slash, `⤡⤢` twin cracks, `⬡⊘` ward-hex. They are the same four shapes, frozen. A reduced-motion player
loses the theatre, never the information.

### 7.4 Performance budget

| Item | Budget | How |
|---|---|---|
| Frame | 16.7 ms; ≤6 ms FX scripting, ≤4 ms style+layout | see below |
| DOM nodes on the board | ~64 squares + ≤32 pins + ≤32 overlays ≈ 130 | pins are **one absolutely-positioned layer**, not children of squares |
| Live particles | **240 max**, hard cap, oldest culled | one 8×8 atlas, one `drawImage` per particle, no gradients or shadows in the loop |
| FX canvas | DPR capped at 2 | rAF loop **only runs when the queue is non-empty**, then stops |
| Weather canvas | 0.5× resolution, 30 fps | separate canvas, `image-rendering: auto` |
| Icon sheet | 383 KB, **1 request** | already baked; offsets in `species.json` |
| gen5 stills (draft cards, capture close-ups) | ~970 B each, ≤40 lazily | `loading="lazy"` |
| Animated GIFs | **off by default** | measured non-uniform (133×140 / 84×78) and absent for some species; opt-in, and only for the acting pin |
| Fonts | 2 families, `woff2`, `font-display: swap`, subset latin | Archivo variable ≈ 34 KB; Plex Sans 400/600 + Mono 500 ≈ 3 × 22 KB |
| Total FX asset bill | 54 authored assets + 1 noise tile + 1 particle atlas | ≈ 12 KB |

**Required refactor, flagged now:** `App.tsx` currently renders each `BoardPiece` as a child of its square's
`<button>`. A pin nested in a grid cell cannot travel between squares without a layout change. Pins must
move to a single absolutely-positioned layer (L2) addressed by
`transform: translate3d(file*cell, rank*cell, 0)`, with the square `<button>`s remaining underneath as the
hit targets and the accessibility tree. Everything in §4 depends on this.

---

## 8. Accessibility

### 8.1 Colour is never alone

| Information | Colour channel | Non-colour channel |
|---|---|---|
| Chess role (6) | none | **silhouette** + size + crest glyph + letter |
| Army (2) | ivory / obsidian metal (15.2:1) | bezel fluting, rim-light direction, sprite facing, board half |
| Type (18) | the fixed 18 hexes | **18 monochrome type glyphs** (§8.2) + the name in the inspector + a 3-letter code in `--t-data` |
| Capture outcome (4) | decorative only | **form, direction, symmetry, death count** (§4) |
| RNG result | die-6 gold / die-1 chalk | pip layout + a crack on the `1` face + die vs coin silhouette |
| Ability / item archetype (25) | 13 low-chroma archetype tints | 25 glyphs |
| Status (7) | bezel tint | collar mark + **motion tell** (including *absence* of motion for `frz`) |
| Hazard layers | none | decal + counted pips |

### 8.2 The 18 type glyphs

18 monochrome 12×12 SVG marks, drawn in the enamel's `liner` colour so contrast is the measured ≥4.95:1.
Derive them from the TCG energy symbols, which millions of players already read: flame (Fire), droplet
(Water), bolt (Electric), leaf (Grass), snowflake (Ice), fist (Fighting), skull-drop (Poison), stratum
(Ground), wing (Flying), spiral eye (Psychic), antenna (Bug), craggy hex (Rock), flame-wisp (Ghost),
claw (Dragon), crescent (Dark), gear (Steel), four-point star (Fairy), circle (Normal).

The seven deuteranopic collisions from finding 4 are resolved by construction: Poison's droplet vs Ghost's
wisp, Fire's flame vs Bug's antenna, Ice's snowflake vs Steel's gear, Grass's leaf vs Rock's hex, Normal's
plain circle vs Psychic's spiral. Verify with a script that renders all 18 glyphs at 12 px in greyscale and
asserts pairwise pixel-difference above a threshold — a fixture, not a vibe.

Also ship the 3-letter codes for the inspector and the notation mode:
`NRM FIR WTR ELC GRS ICE FGT PSN GRD FLY PSY BUG RCK GHO DRG DRK STL FRY`.

### 8.3 Focus, keyboard, and Notation mode

**Focus ring** must not collide with `--gold` (which means "extra move"), so it differs in both colour and
geometry: **a 3 px `#FFFFFF` corner reticle (four L-brackets) with a 1 px `--ink` outer edge.** Measured
5.88:1 / 3.48:1 against the two squares. Gold rings are always *full* rings around a pin; focus is always
*brackets* at a square's corners. Different shape, no ambiguity. `:focus-visible` only; never suppressed.

**Keyboard play** — the board is a single composite widget with `role="grid"` and one tab stop:

| Key | Action |
|---|---|
| `←↑→↓` | move focus one square |
| `Home / End` | first / last file of the rank; `PgUp / PgDn` first / last rank |
| `Enter` / `Space` | select the focused pin; `Enter` again on a target commits |
| `Tab` while a pin is selected | cycle its legal destinations in Chebyshev order |
| `Esc` | deselect |
| `1–4` | fire the selected pin's move slots 1–4 |
| `x` | toggle the threat overlay |
| `t` | toggle Notation mode |
| `i` | read the focused pin's full card into the live region |
| `Space` (nothing selected) | skip / flush animations |

**Notation mode** (`t`): the enamel keeps its type hue and glyph, but the sprite is replaced by a large
`K Q R B N P` in Plex Mono 600 at 46% of the cell, ink on light army, bone on dark army. For a strong chess
player this is simply the fastest board in the game, and it is also the highest-contrast board we can draw.
Offer it, do not default to it.

### 8.4 Screen-reader announcements

One `aria-live="assertive"` region for outcomes and turn changes; one `polite` region for ambient events
(weather, hazards, status ticks, timers). Announcement strings — fixed grammar,
`<attacker>, <type> <role>, <verb> <defender>, <type> <role>. <Outcome>. <Consequence>.`:

```
ADVANTAGE  "Charizard, Fire bishop, takes Golisopod, Bug rook. Super effective. Charizard moves again."
TRADE      "Sandslash, Ground rook, takes Magnezone, Steel knight. Neutral."
BACKLASH   "Skarmory, Steel knight, attacks Ferrothorn, Steel rook. Not very effective.
            Both pieces destroyed."
BLOCKED    "Blocked. Ground has no effect on Flying. Sandslash returns to c4."
CRIT       "Rolled six. Critical hit. Pikachu takes Gyarados, Water queen. Pikachu moves again."
MISS       "Rolled one. Miss. Pikachu returns to e4."
TEMPO      "Turn 14. Critical type Water. Flinch type Grass."
PROMOTION  "Magnemite reaches rank eight and evolves into Magnezone. Now a queen. Steel type."
WARD       "Air Balloon popped. Skarmory is now grounded."
EXTRA      "Extra move available. Twenty-one squares."
```

Every pin's square `<button>` keeps a full `aria-label` (the current code already does this well — keep the
pattern) and gains `aria-describedby` pointing at a hidden node carrying type, ability, item, status and
Weakness/Resistance summary, read by `i`.

### 8.5 Text contrast

All measured. `--text` on `--stage` **16.1:1**; `--text-2` on `--stage` **8.5:1**; `--text-3` on
`--panel-raised` **5.2:1** (labels ≥12 px only); `--gold` on `--stage` **11.5:1**. Nothing ships below
4.5:1 for body text or 3:1 for ≥18 px / bold ≥14 px. Type-coloured text is **forbidden**: 13 of the 18
hexes fail 4.5:1 on `--stage`. A type is always a *chip* (hex fill + `textColorOn()`, which
`typeColors.ts` already computes from luminance), never coloured type.

---

## 9. Screens

### 9.1 Title — the hero is the game's central moment, playing

```
┌──────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│   ┌────────────────────────────────────────────────────────────────┐     │
│   │                                                                │     │
│   │        a LIVE BOARD, 3/4 view, playing a recorded 6s loop       │     │
│   │        of one ADVANTAGE capture: lunge → star → gold ring       │     │
│   │        → the free move. Slowed to 0.6×. Sound off by default.   │     │
│   │                                                                │     │
│   └────────────────────────────────────────────────────────────────┘     │
│                                                                          │
│      P O K É M O N   C H E S S           Archivo 800, wdth 118, 52px     │
│      Type knowledge beats chess strength.   Plex Sans 400, 15px          │
│                                                                          │
│      ▸ SANDBOX  play now, no account      ← primary, brass border        │
│      ▸ CAMPAIGN                                                          │
│      ▸ MY COLLECTION                                                     │
│                                                                          │
│      1025 Pokémon · 950 moves · 311 abilities · 536 items   ← from the   │
│                                                               manifest   │
│      Fan project. Not affiliated with Nintendo / Creatures / GAME FREAK. │
└──────────────────────────────────────────────────────────────────────────┘
```

The hero is not a logo on a gradient; it is **the mechanic**. Six seconds of the game's most important beat,
before a single word of copy. Per `DIRECTION.md`, sandbox is the default entry and requires no account —
so it is the first, brightest, and largest control. The counters are real numbers read from
`manifest.json`, not marketing.

### 9.2 Draft — "The Badge Case"

The hard screen. 1025 Pokémon must feel exciting, not paralysing, and it must teach the type chart while
you pick. **The answer is that you never browse 1025 — you are offered five, for one specific slot.**

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│  ROUND 4 / 16   ● YOUR PICK   filling: ROOK 2   budget 41.50 / 64.00   ⟲ 1 left  │
├──────────────────┬────────────────────────────────────────────┬──────────────────┤
│  YOUR CASE       │              THE OFFER                     │   TYPE WHEEL     │
│                  │                                            │                  │
│  ♚ ♛ ♜ · ♝ ♞ ·   │  ┌────────┐┌────────┐┌────────┐┌───┐┌───┐  │      ▲FIR        │
│  ♟ ♟ ♟ ♟ · · · · │  │FERROTH.││SKARMORY││GOLISOP.││ … ││ … │  │  ▲WTR   ▲GRS     │
│                  │  │ ◈STEEL ││◈STL/FLY││ ◈BUG   ││   ││   │  │ ELC       ICE    │
│  filled sockets  │  │  ROOK  ││  ROOK  ││  ROOK  ││   ││   │  │ ▲    ○ ○     ▲   │
│  show the pin;   │  │ 5.61 pt││ 5.4 pt ││ 3.85pt ││   ││   │  │  the 18 spokes;  │
│  empty ones are  │  │ ▲ ×2 vs││        ││        ││   ││   │  │  filled = owned  │
│  recessed        │  │ ICE RCK││        ││        ││   ││   │  │  length = best V │
│                  │  │ FRY    ││        ││        ││   ││   │  │                  │
│  ← the slot you  │  │ ▼ 10 ty││        ││        ││   ││   │  │  4 gaps left     │
│    are filling   │  │ ⊘ PSN  ││        ││        ││   ││   │  │                  │
│    pulses        │  └────────┘└────────┘└────────┘└───┘└───┘  │                  │
├──────────────────┴────────────────────────────────────────────┴──────────────────┤
│ COVERAGE  NRM FIR WTR ELC GRS ICE FGT PSN GRD FLY PSY BUG RCK GHO DRG DRK STL FRY│
│ your best  ●   ●   ○   ●   ●   ◐   ●   ✕   ●   ◐   ●   ●   ○   ●   ●   ○   ✕   ● │
│            ↑ hovering FERROTHORN previews the two cells it fixes, animated       │
└──────────────────────────────────────────────────────────────────────────────────┘
```

**Anti-paralysis mechanics:**
1. **Five cards, not 1025.** Each round the engine offers 5 candidates *for the slot you are filling*,
   drawn by `roleAffinity` from the active pool source (`full-dex` or `collection` — the hard seam
   `DIRECTION.md` requires). The offer is generated with a **guaranteed spread**: at least one type you do
   not yet own, at least one option that fits comfortably under budget, at most one Legendary/Restricted.
2. **One reroll per draft.** A visible, spendable resource.
3. **Search is an escape hatch, not the interface.** Behind a toggle, for the 1%. Same pattern
   `recon-moves.md` §6.4 uses for movesets — consistency across the game.
4. **Slot-first, not pool-first.** You are always answering one question ("who is my second rook?"), never
   sixteen at once.

**How it teaches the type chart** — three devices, in increasing commitment:
- **The card, in TCG vocabulary** (which `DIRECTION.md` mandates): `▲ WEAKNESS ×2 vs [chips]`,
  `▼ RESISTANCE vs [n]`, `⊘ NO EFFECT vs [chips]`. Chips, not words, so 18 hues + 18 glyphs get repeated
  hundreds of times before the first match.
- **The Type Wheel**: 18 radial spokes; a spoke's fill = you own that type, its length = your best
  `V(piece)` for it. Gaps are visually obvious. This is the "at least one of every type" goal made a
  *picture* instead of a validation error.
- **The Coverage Strip**: 18 cells, one per *enemy* type, each showing how well your current army answers
  it (`● good · ◐ thin · ○ none · ✕ you lose to it`). **Hovering a candidate card animates the cells it
  would fix**, staggered 30 ms. You learn the chart by watching your holes close — the most direct
  teaching loop available.

**The declared-type beat.** For a dual-typed pick, the card **splits down the middle** (240 ms,
`--ease-out-quart`) into two halves — `◈ WATER` | `◈ ICE` — and the Coverage Strip previews *each* as you
hover it. This is the single most on-brief interaction in the game (original ruleset rule 2, "Lapras is
Water *or* Ice — the player picks") and it gets its own micro-moment rather than a dropdown.

**The pick animation.** Card lifts (`scale 1.06`, 120 ms), the losing four cards fall away and desaturate
(180 ms, 40 ms stagger), the picked card **shrinks into its socket** in Your Case along an arc (340 ms,
`--ease-in-out-quint`) and lands as a finished pin with a `--ease-out-back` bounce and a single type-coloured
ring pulse. The Type Wheel spoke grows, the Coverage Strip cells update. Total 620 ms; the next offer deals
in at 480 ms with a 60 ms stagger, so it overlaps.

### 9.3 Match

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ ◈◈◈ BLACK  ⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡           04:12   seed 8f3a2   ⏵1× ⤓ ⚙       │
├──────────────┬─────────────────────────────────────────────┬──────────────────┤
│  INSPECTOR   │                                             │   TURN RAIL      │
│              │                                             │  ┌────┐          │
│ ┌──────────┐ │             T H E   S L A B                 │  │ ⚄  │ tempo    │
│ │ FERROTH. │ │                                             │  └────┘          │
│ │ ♜ ROOK   │ │        720px max · square · brass frame     │  CRIT   ▲ ◈WTR   │
│ │ ◈ STEEL  │ │                                             │  FLINCH ▼ ◈GRS   │
│ │ ⛨ Iron   │ │        (pins on L2, one transform layer)     │  ─────────────   │
│ │   Barbs  │ │                                             │  14. Nc3  ×Bug ▲ │
│ │ ✦ Rocky  │ │                                             │  14… e5          │
│ │   Helmet │ │                                             │  15. ×Steel ⇄⇄   │
│ │ ▲×2 vs   │ │                                             │  ─────────────   │
│ │  ICE RCK │ │                                             │  Iron Barbs fired│
│ │  FRY     │ │                                             │  Spikes ×2 on d6 │
│ │ ▼ 10     │ │                                             │  Rain, 3 turns   │
│ │ ⊘ PSN    │ │                                             │                  │
│ │ Vigour●●○│ │                                             │                  │
│ └──────────┘ │                                             │                  │
├──────────────┴─────────────────────────────────────────────┴──────────────────┤
│ ◈◈◈ WHITE  ⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡⬡    [ Wild Charge ][ Discharge ][ T.Wave ][ Spark ]│
└───────────────────────────────────────────────────────────────────────────────┘
```

- **Trays** are 16 recessed sockets per side along the top and bottom. Captured pins fill the *opponent's*
  tray, tarnished (desaturate 100%, brightness 0.7). Material count is "how many sockets are filled" —
  readable without arithmetic.
- **Inspector** (left) shows the hovered-or-selected pin's card: name, role glyph, type chip, ability
  archetype + name, item class + name, the TCG Weakness/Resistance/No-effect chip rows, Vigour pips,
  status marks. On hover it is a preview; on selection it pins.
- **Turn rail** (right) top-to-bottom: the Tempo Die and its two chips, the move list in Plex Mono with
  outcome marks inline (`▲` advantage, `⇄` backlash, `⊘` blocked, `⚄6` crit), then the event log for
  abilities/items/hazards/weather. Three zones, one column, never a modal.
- **Move buttons** (bottom right) are the selected pin's 4 slots, each showing its type chip, shape icon and
  remaining charges as pips. Disabled slots are recessed, not hidden.
- **Speed / skip / settings** live in the header rail, always reachable, one click.
- Below 1180 px both rails collapse into a bottom sheet with three tabs (Inspect / Rail / Log); the board
  keeps its full width down to a 320 px floor.

### 9.4 Post-game — the Match Card

One scrollable card, no dashboard.

```
┌─────────────────────────────────────────────────────────────┐
│  W H I T E   W I N S                     Archivo 800, 52px  │
│  King captured on move 31 · 4:52                            │
├─────────────────────────────────────────────────────────────┤
│  THE MOMENT     [ a replayable 4s clip of the decisive beat ]│
│                 ⏵ replay   ⤓ share (seed + move list)        │
├─────────────────────────────────────────────────────────────┤
│  MATERIAL       a step line over sub-moves, gold marks where │
│                 an extra move was earned                     │
├─────────────────────────────────────────────────────────────┤
│  OUTCOMES       ▲ 7 advantage   ─ 11 trade                   │
│                 ⇄ 4 backlash    ⊘ 2 blocked                  │
│                 (the same four glyphs as the board. always.) │
├─────────────────────────────────────────────────────────────┤
│  BY TYPE        18 bars: captures made / lost, per type      │
├─────────────────────────────────────────────────────────────┤
│  YOUR REWARD    choose one:  [ card ] [ card ] [ card ]      │
│                 (per DIRECTION §meta-game — a loss still     │
│                  offers something, just fewer and commoner)  │
└─────────────────────────────────────────────────────────────┘
```

The reward beat gets the promotion treatment in miniature: the chosen card flips (`rotateY`, 420 ms), the
new pin lands in the collection with a `--ease-out-back` bounce and one type-ring pulse, and the Pokédex
counter ticks up with tabular numerals so the digits do not jump.

---

## 10. Conflicts with existing docs, and rulings

1. **`recon-abilities-items.md` §4.4's piece card is a text block; §2.3 of this doc is a pin.** No conflict:
   its 25-glyph budget and 13 archetype colours are adopted wholesale as the *inspector card* and the
   ≥64 px plinth glyphs. Its ASCII card is the inspector; the pin is the board.
2. **`recon-abilities-items.md` §3.4 assigns Poké Balls to "the piece's summon animation".** There is no
   summon animation in this design (pieces are drafted onto the board, not summoned). **Ruling:** Ball skins
   become the **bezel finish** — 28 alternative metal treatments for the pin (chrome, matte, hammered,
   verdigris, …), applied per-army. Same cosmetic slot, and it survives at 40 px, which a summon animation
   would not.
3. **`recon-abilities-items.md` §5.4 keeps the 34 Gigantamax sprites as promotion art.** Conflict with
   finding 7: `-Gmax` sprites are non-uniform and the promotion beat needs a fixed frame. **Ruling:** use
   the `gen5` still (96×96, ~970 B) for the flicker silhouettes, and the Gmax sprite only in the *inspector*
   detail view where size is free. The promotion animation must not depend on per-species art dimensions.
4. **`BRIEF.md` §3 says "Types 19 (18 + `???`)"; `recon-variants.md` §8.1 says 18 + `Stellar`.**
   Variants wins (it is measured, and the substrate doc agrees). **Visual ruling:** `Stellar` is excluded
   from drafting and therefore gets **no enamel colour and no glyph** — nothing to design.
5. **`recon-variants.md` §6.3 recommends abolishing the per-capture die in favour of public turn-start
   randomness; the video's rules roll per capture.** The ruleset is not mine to settle. **This spec supports
   both** by separating cause markers from consequence forms (§5.2): the Tempo Die serves input randomness,
   the Clash Die serves output randomness, and neither changes the four consequence animations. Whichever
   ships, no animation work is wasted.
6. **`DIRECTION.md` says "The 18 type colours are already fixed … treat them as the palette's spine."
   Finding 1 says the current board makes all 18 illegible.** No contradiction — the fix is the *board*,
   not the type colours. This doc changes zero values in `typeColors.ts`.
7. **The existing `pieceRoles.ts` commits to Unicode glyphs as the primary role channel.** This doc
   overrules that (§2.7) on measured grounds. `ROLE_GLYPH`, `GLYPH_FONT_STACK` and the U+FE0E workaround
   should be **kept for the legend, the inspector and text output**, and removed from the board pin.
   `ROLE_SPRITE_SCALE` / `ROLE_RING_WEIGHT` are superseded by the 6-tier fill table in §2.2.

---

## 11. Build order

Staged so each stage is complete and shippable, per `DIRECTION.md`'s "very functional means shipped".

| Stage | Contents | Why first |
|---|---|---|
| **V1 — Legibility** | New tokens (§1.4), slate board (§3), the 6 role silhouettes + pin anatomy (§2.3), the liner rule (§2.4), typography (§1.5), the greyscale-downscale fixture (§2.5) | This is the fatal bug. Nothing else matters until roles read. |
| **V2 — Motion spine** | Pins onto L2 as one transform layer (§7.4), lanes + `fx.flush()` (§7.2), duration/easing tokens, speed/skip/reduced-motion (§7.3) | Every effect depends on this architecture; retrofitting it later is expensive. |
| **V3 — The four outcomes** | §4 in full, including the persistent ADVANTAGE state and the reduced-motion stamps | The acceptance criterion `DIRECTION.md` names first. |
| **V4 — RNG instruments** | Tempo Die, Clash Die, Coin (§5) | Small, self-contained, high drama per line of code. |
| **V5 — Composable move FX** | 12 emitters + 12 resolvers + 18 skins + 8 primitives (§6.1–6.4) | Bounded at 54 assets; unlocks all 950 moves at once. |
| **V6 — Marquee state** | hazards, status, weather/terrain, trapping, promotion (§6.5) | Depends on V5's primitives. |
| **V7 — Screens** | title, draft, HUD, post-game (§9) | The draft is the biggest single piece of UI work in the project; do it once, on top of a settled visual language. |
| **V8 — Accessibility hardening** | 18 type glyphs, keyboard grid, Notation mode, live regions (§8) | Threaded through V1–V7, audited as its own pass, never left last as a bolt-on. |

### Fixtures a reviewer should be able to run

1. **Greyscale role test.** Render the board at 40 px cells, downscale 50%, desaturate; every role must
   still be nameable. Stored as a PNG fixture.
2. **CVD sweep.** Render one pin per type and simulate protanopia / deuteranopia / tritanopia; assert every
   pin is still uniquely identifiable *with* its glyph.
3. **Contrast assertions as unit tests.** Assert the numbers in §1.4 and §2.4 (`≥3:1` bezel vs both squares,
   `≥4.95:1` rim vs liner, `≥4.26:1` pool vs outline, `≥4.5:1` all body text) directly from the token
   values, so a token edit that breaks accessibility fails CI.
4. **Outcome silhouette test.** Render the four static stamps at 24 px in greyscale; assert pairwise pixel
   difference above a threshold. This is what guarantees finding 3's conclusion actually holds.
5. **Frame budget.** A scripted worst case — 32 pins, weather up, a 5-hit multi-hit ADVANTAGE with a
   promotion queued — must hold 60 fps with ≤240 live particles.
