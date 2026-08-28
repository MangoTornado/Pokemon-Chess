# Recon: Rendering, Performance & AI Search

> Role: rendering / performance / AI-search analyst.
> Scope: Brief §5.7 (Rendering & performance) and §5.8 (AI opponent).
> Everything numeric in this document was **measured on this machine** during design (Apple Silicon
> macOS 25.6, Node v24.19.0, Chromium via Playwright). Probe scripts are listed in
> [Appendix A](#appendix-a--probe-inventory) so every number is reproducible.
> Constraints from the Brief (TypeScript strict, Vite, npm, pure engine core, Vitest, baked data)
> are taken as given.

---

## 0. Decisions, up front

| # | Question | Decision | Confidence |
|---|---|---|---|
| A1 | Board & piece rendering | **DOM + CSS `transform` (GPU-composited), one `<canvas>` FX layer above it.** No WebGL, no Pixi. | High — measured, and forced by a CORS finding |
| A2 | Animation library | **None as a hard dependency.** Web Animations API (`Element.animate`) for piece motion, hand-rolled rAF loop for the canvas FX layer. `motion/mini` (3 KB gz measured) is the fallback if WAAPI ergonomics hurt. | High |
| A3 | Sprite source | **Showdown `sprites/gen5/*.png`, 96×96, all 1025 base formes = 829 KB total (measured).** Vendored at build time by a script, never committed. | High |
| A4 | Spritesheet? | **No** for the board. Individual PNGs beat a packed atlas by 3× (849 KB vs 2563 KB, measured). **Yes** for the dex/draft grid: reuse Showdown's `pokemonicons-sheet.png`, 383 KB, one request, covers every forme. | High — counter-intuitive, measured |
| A5 | Runtime CDN vs vendored | **Vendored.** `play.pokemonshowdown.com` sends **no `Access-Control-Allow-Origin`** — measured. That taints canvases, blocks `fetch()`, and makes WebGL `texImage2D` throw `SecurityError`. | High — hard blocker |
| A6 | Licensing stance | Ship **zero** Pokémon art in git. Vendor script + `ATTRIBUTION.md` + a fully playable **Type Glyph mode** with no Pokémon assets at all. | High |
| B1 | Off-the-shelf engine | **Unusable.** Not Stockfish, not Fairy-Stockfish. Nothing salvageable except *ideas* and `chess.js` as a **test oracle** (already the Brief's position). | High |
| B2 | Search | **Alpha-beta negamax over a *collapsed* game tree** (chance nodes replaced by modal outcome + static EV correction) **with exact chance expansion at the root only.** Not full expectiminimax, and explicitly **not** star1/star2. | High — measured; star1 made it *worse* |
| B3 | "Ply" definition | An extra move from super-effective/crit is a **same-side child at depth−1** with a hard chain cap of 2. Costs ~50% more nodes than banning chains (measured). | High |
| B4 | Threading | **Web Worker, plain JS/TS. No WASM.** Measured 3.0–3.3 M nodes/s in pure JS is enough for the target strength. | High |
| B5 | Difficulty dial | **Corrupt the AI's type chart**, don't just cut its depth. Measured: 5 % type-error → 47 % score, 30 % → 37 %, 100 % → 25 %. Monotonic, thematic, and cheap. | High — measured |

---

## PART A — RENDERING & ASSETS

### A.0 The measurement that settles the architecture

Before comparing renderers: I tested whether a browser can actually *use* Showdown sprites from the CDN.
Probe: `/tmp/corstest/index.html`, run in Chromium.

```
1. plain <img> load:                                  OK 96x96
2. canvas2d drawImage:                                 OK
3. getImageData after cross-origin draw:               THROW SecurityError -> CANVAS TAINTED
4. toDataURL:                                          THROW SecurityError
5. webgl context:                                      OK
6. webgl texImage2D(non-CORS img):                     THROW SecurityError
7. <img crossOrigin=anonymous> from Showdown:          FAIL (blocked, no ACAO header)
8. fetch() cross-origin:                               THROW TypeError: Failed to fetch
```

Confirmed on the wire — Showdown sends the *decoy* CORS headers but not the one that matters:

```
$ curl -sI https://play.pokemonshowdown.com/sprites/gen5/pikachu.png
access-control-allow-methods: GET,POST,OPTIONS
access-control-allow-headers: Content-Type, X-Requested-With
   ...and NO access-control-allow-origin.
```

(`raw.githubusercontent.com/PokeAPI/sprites` *does* send `access-control-allow-origin: *` — verified —
but its artwork is ~124 KB/sprite, 89 MB for the dex, and GitHub raw is not a hotlinkable CDN.)

**Consequences, which are not negotiable:**

1. **"PixiJS + Showdown CDN at runtime" is impossible.** Pixi/three set `crossOrigin` on their image
   loads; without ACAO the load fails, and even a plain `<img>` fed to `texImage2D` throws.
2. **Canvas2D + Showdown CDN is crippled.** `drawImage` works, but the canvas is permanently tainted:
   no `getImageData`, no `toDataURL`, so no runtime atlas packing, no pixel-level recolouring
   (type-tinting, silhouettes, hit-flash), no screenshot/share feature.
3. **DOM `<img>` / CSS `background-image` is the only thing that works unmodified against the CDN.**
   That is also exactly what `@pkmn/img` emits — see A.2.
4. If you *vendor* the sprites (serve them same-origin), all three options unlock again. So this finding
   does not by itself forbid Pixi; it forbids Pixi-with-CDN, and it makes vendoring mandatory for
   *any* pixel-manipulating approach.

References: [MDN: CORS-enabled image](https://developer.mozilla.org/en-US/docs/Web/HTML/CORS_enabled_image),
[MDN: `crossorigin` attribute](https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/crossorigin).

---

### A.1 Rendering approach

#### A.1.1 Measured frame cost

Probe: `/tmp/corstest/perf.html` (Chromium, 400 frames each, 640×640 board, 80 px squares).
Numbers are **main-thread script time per frame** — the part we control.

| Scenario | mean | p50 | p95 | max |
|---|---|---|---|---|
| A — 64 DOM pieces, `translate3d` rewritten every frame | 0.092 ms | 0.100 | 0.200 | 0.300 |
| B — 64 DOM pieces + **400 DOM particles** (transform + opacity) | 0.449 ms | 0.500 | 0.700 | 1.000 |
| C — 64 DOM pieces + **400 Canvas2D particles** | 0.235 ms | 0.200 | 0.400 | 0.500 |
| D — 64 DOM pieces + **2000 Canvas2D particles** | 0.417 ms | 0.400 | 0.500 | 1.400 |

Read the two comparisons that matter:

- **B vs C:** at the *same* 400 particles, Canvas2D costs **half** the script time of DOM particles —
  and DOM particles additionally cost 400 nodes of style recalc, layerisation and compositor memory
  that this counter does not show. DOM loses for particles.
- **C vs D:** 5× the particles for 1.8× the cost. Canvas2D scales sub-linearly here because the
  per-draw cost is dominated by the `arc`+`fill` call, and it stays flat as counts rise. Canvas wins
  for FX at any interesting scale.
- **A:** 64 DOM sprites moved by transform is **0.09 ms**. This is ~0.5 % of a 16.67 ms frame.
  A WebGL renderer cannot meaningfully improve on 0.09 ms; there is no performance problem to solve
  at 32–64 sprites.

#### A.1.2 Measured bundle cost

Real tree-shaken `esbuild --bundle --minify` outputs, gzip -9 (`/tmp/bundletest`):

| Package | entry used | min | **min+gzip** |
|---|---|---|---|
| `pixi.js@8` | `Application, Container, Sprite, Texture, Assets, Graphics, BlurFilter` | 562 KB | **165 KB** |
| `pixi.js@8` (full `pixi.min.mjs`, untree-shaken) | — | 800 KB | 225 KB |
| `motion@12` | `animate, spring` | 61 KB | **22 KB** |
| `motion@12` | `motion/mini` → `animate` | 7 KB | **3 KB** |
| `react@19 + react-dom@19` | `createRoot` + hooks | 188 KB | **58 KB** |
| `preact@10 + preact/hooks` | `render, h`, hooks | 12 KB | **5.3 KB** |
| `@pkmn/img@0.3.4` (dist, gzip) | — | 194 KB | 41 KB |
| `chess.js@1.4.0` (dist, gzip) | — | 104 KB | 23 KB |

PixiJS costs **165 KB gzipped** — more than React and the entire baked Pokémon dataset combined
(58 + 25 ≈ 83 KB, see A.2) — to solve a problem that measures 0.09 ms.

#### A.1.3 The four candidates, judged

| | DOM + CSS transforms | Canvas2D (everything) | WebGL / PixiJS | **Hybrid: DOM board+pieces, Canvas FX** |
|---|---|---|---|---|
| 32–64 sprite perf | 0.09 ms/frame ✅ | fine, but you redraw 64 sprites every frame even when idle | overkill | 0.09 ms + FX only when firing ✅ |
| Heavy simultaneous VFX | 400 DOM particles = 0.45 ms and 400 extra layers ❌ | ✅ | ✅ best in class | 2000 particles = 0.42 ms ✅ |
| Text / a11y / screen reader | native: real `<button>` per square, `aria-label`, focus ring, tab order ✅ | must reimplement an entire a11y tree ❌ | same ❌ | ✅ (a11y lives in DOM) |
| Crisp pixel sprites | `image-rendering: pixelated` ✅ | `imageSmoothingEnabled=false` ✅ | `scaleMode: 'nearest'` ✅ | ✅ |
| Showdown CDN usable | ✅ only option | tainted ⚠️ | **throws** ❌ | ✅ |
| Bundle delta | **0 KB** | 0 KB | **+165 KB gz** ❌ | **0 KB** |
| Hit-testing / drag | native pointer events on squares ✅ | manual math | manual math | ✅ |
| CSS theming, dark mode, i18n | free ✅ | reimplement ❌ | reimplement ❌ | ✅ |
| Debuggability | DevTools inspects a piece ✅ | opaque ❌ | opaque ❌ | ✅ |
| Risk if we need 5000 particles + shaders | must add canvas | — | ✅ | already have canvas ✅ |

**Recommendation: the hybrid.**

- **Layer 0 — board.** One `<div class="board">` with 64 child `<button class="sq">`. Static; painted once.
  Coordinates, last-move highlight, legal-move dots, check ring are CSS classes on the square.
- **Layer 1 — pieces.** One absolutely-positioned `<div class="piece">` per piece,
  `background-image: url(/sprites/gen5/<id>.png)`, `image-rendering: pixelated`,
  positioned solely by `transform: translate3d(x, y, 0)`. Never `left`/`top` (those force layout).
  `will-change: transform` on pieces only while a move is animating, then removed (permanent
  `will-change` on 32 nodes wastes compositor memory).
- **Layer 2 — FX canvas.** A single `<canvas aria-hidden="true">` sized to the board, `pointer-events: none`,
  `position: absolute; inset: 0`. All particles, shockwaves, type-symbol bursts, damage numbers, screen
  shake. One `clearRect` + one draw pass per frame. The rAF loop **only runs while the FX queue is
  non-empty** — idle board costs zero frames.
- **Layer 3 — UI chrome.** React (already a dependency): move list, captured tray, type matchup panel,
  draft screen, modals. Plain DOM, plain CSS.

**What I traded away:** if a future version wants full-screen shader effects (a real Fire-type flame
field with additive blending and displacement), Canvas2D will start to hurt and Pixi becomes right.
The hybrid contains that risk cheaply: the FX layer is already a canvas, so swapping its
implementation for a WebGL context is a change to one module (`src/ui/fx/Renderer.ts`), not to the
board, pieces, input, or a11y. I am deliberately deferring 165 KB until a measured need exists.

**Also rejected:** replacing React with Preact. It would save 53 KB gz, but React is already in
`package.json`, React 19 is a pre-decided-adjacent choice, and 53 KB is inside budget. Revisit only
if the initial-load budget in A.4 is breached.

#### A.1.4 Frame budget maths

60 fps = **16.67 ms** per frame, and the main thread does not own all of it: style, layout, paint,
composite, plus the browser's own work. Chrome's own guidance is to keep long tasks off the main
thread and target interaction response well under 200 ms
([web.dev INP](https://web.dev/articles/inp)); for animation the practical rule is to leave ≥40 %
of the frame to the compositor.

Working budget, per frame, at 60 fps:

| Consumer | Budget (mid laptop) | Budget (mid mobile, 30 fps floor) | Measured here | Notes |
|---|---|---|---|---|
| Piece transforms (≤64) | 0.5 ms | 1.0 ms | **0.09 ms** | transform-only ⇒ no layout, compositor-only |
| FX canvas draw (≤1500 particles) | 2.0 ms | 4.0 ms | **0.42 ms @ 2000** | one canvas, one pass |
| React re-render (UI chrome) | 2.0 ms | 3.0 ms | — | must not re-render during animation; see below |
| Engine work on main thread | **0 ms** | **0 ms** | — | move-gen for the *human's* legal moves is <1 ms and precomputed on turn start; AI is in a Worker |
| Style/layout/paint/composite headroom | ≥8 ms | ≥15 ms | — | slack |
| **Total main-thread script** | **≤4.5 ms** | **≤8 ms** | **≈0.5 ms** | ~9× headroom |

Derating assumption stated explicitly: I have no mid-range Android here. I assume **3–5× slower**
single-thread JS and ~2× slower raster than this machine. Even at 5× derating the measured
0.5 ms becomes 2.5 ms — 15 % of a 60 fps frame. The rendering architecture is not the risk;
**the AI Worker and the initial payload are** (§A.4, §B).

The one real trap: **React re-rendering during animation.** Rule: the animating layer is *not* React
state. Pieces are React-rendered once per *position*, and their `transform` is driven imperatively by
the animation controller (WAAPI/rAF) between positions. React sees one commit per completed move, not
one per frame. Enforce with a `useSyncExternalStore` subscription to the game store that only fires on
position change, and a lint rule banning `useState` inside `<Piece>`.

---

### A.2 Asset strategy for 1025 Pokémon

#### A.2.0 A data correction the Brief needs

The Brief's "Standard base formes only: **733**" is `new Generations(Dex).get(9).species` filtered —
i.e. **Gen 9 legality**, not the National Dex. Measured (`probe_rendersearch_gaps.mjs`):

```
Generations(Dex).get(9).species          -> 876 entries, ALL with isNonstandard === null
  base formes, unique dex num            -> 733
  dex numbers 1..1025 NOT covered        -> 292
  e.g. MISSING: Alakazam, Machamp, Caterpie(10-15), Nidoran-F/M, Farfetch'd, Mr. Mime, Type: Null
Dex.species.all(), forme==='' , num>=1   -> 1025 base formes, gaps in 1..1025: 0
```

Two hard implications:

1. **A game that promises "all 1025" must build its species table from `Dex.species.all()`, not from
   `Generations(Dex).get(9)`.** Using the gen-9 view silently deletes Alakazam and Machamp — two of the
   most iconic possible bishops/rooks in the entire concept.
2. Asset budgets must be sized for **1025**, not 733. All numbers below are for 1025.

#### A.2.1 Measured sprite economics

All 1025 base-forme sprites downloaded and measured (`probe_rendersearch_dl1025.mjs`):

```
gen5 all base: got 1025/1025  missing=0
total=829 KB  mean=0.81 KB  p50=0.69 KB  p95=1.24 KB  max=10.44 KB
32 pieces @mean = 26 KB   64 @mean = 52 KB
```

Every one of the 1025 exists, including Gen 9 species (Showdown backfills gen-5-style sprites —
`gen5/koraidon.png` is a real 96×96, 1455 B). Verified visually: I rendered a 16-species board at
80 px with `image-rendering: pixelated` and inspected it. It looks **good** — crisp, consistent,
period-correct pixel art, no blurry upscaling.

Other sources, sampled 74 species spread across the dex (`probe_rendersearch_sizes.mjs`):

| Source | dims | mean | p50 | p95 | 32-piece game | whole dex (1025 est.) | CORS |
|---|---|---|---|---|---|---|---|
| **`sprites/gen5/*.png`** | 96×96 | **0.81 KB** | 0.69 | 1.24 | **26 KB** | **829 KB** (exact) | none |
| `sprites/dex/*.png` | 120×120 | 4.2 KB | 3.3 | 9.7 | 134 KB | ~4.2 MB | none |
| `sprites/ani/*.gif` | ~60×60 anim | 61.9 KB | 52.4 | 146.3 | **1.98 MB** | ~62 MB | none |
| `sprites/gen5ani/*.gif` | ~50×46 anim | 46.1 KB | 32.5 | 76.8 | 1.47 MB | ~46 MB | none (**20/74 = 27 % 404**) |
| PokéAPI official-artwork | 475² | 124.1 KB | 123.8 | 170.8 | 3.97 MB | ~124 MB | `*` |
| PokéAPI home | 512² | 121.7 KB | 121.2 | 172.2 | 3.90 MB | ~122 MB | `*` |
| PokéAPI showdown gif (jsDelivr) | anim | 63.5 KB | 53.2 | 146.8 | 2.03 MB | ~64 MB | `*` |
| `pokemonicons-sheet.png` | 40×30 × all formes | — | — | — | 0 (one sheet) | **383 KB** | none |
| `itemicons-sheet.png` | 24×24 × all items | — | — | — | — | **87 KB** | none |

The Brief's figures are confirmed and sharpened: gen5 stills are "~0.5–few KB" (mean 0.81 KB),
`ani/` GIFs are "~26 KB" for Pikachu specifically but **mean 62 KB, p95 146 KB** across the dex —
2.4× the Brief's estimate. PokéAPI official artwork is 124 KB mean, slightly under the Brief's 200 KB.

#### A.2.2 Do NOT build a board spritesheet

I built real atlases in Chromium (`atlas1025.html`) from the 1025 downloaded PNGs:

| Packing | canvas | PNG | WebP lossless | WebP q0.9 | WebP q0.8 |
|---|---|---|---|---|---|
| 96 px, 32 cols | 3072×3168 | **2563 KB** | 2238 KB | 1744 KB | 1376 KB |
| 64 px downscaled | 2048×2112 | 2786 KB | 2344 KB | 1007 KB | 814 KB |
| 48 px downscaled | 1536×1584 | 1694 KB | 1396 KB | 690 KB | 562 KB |
| **1025 individual PNGs** | — | **849 KB** | — | — | — |
| (733 gen-9 subset, 96 px atlas) | 2688×2592 | 1840 KB | 1575 KB | 1258 KB | 993 KB |

**A packed atlas is 3× *larger* than the individual files.** The reason is structural, not a tuning
miss: each sprite is its own ≤16-colour indexed PNG with an optimal palette; merging 1025 of them
forces one shared full-colour image and destroys every palette. Downscaling to 48 px halves it but
still loses to individual files, and costs the crispness that makes the art look good.

Also measured: concatenating the 1025 files into one blob = 848,761 B, and gzipping that blob only
gets to 771 KB (**9 %**), because PNG is already DEFLATE'd. There is no compression win available.

So the only argument for an atlas would be request count — and that argument dies too, because
**a game needs 32 sprites, not 1025.** The draft pool in the original ruleset is
2 K + 2 Q + 4 B + 4 N + 4 R + 16 P = **32 Pokémon**, which is exactly both armies
(16 per side). 32 sprites × 0.81 KB = **26 KB**.

#### A.2.3 Measured load time

Probe `/tmp/corstest/tti.html`: fetch a manifest, then load and paint 32 random species onto a
640×640 DOM board, single-threaded Python `http.server` over HTTP/1.1 (a deliberately hostile server).

```
manifest fetch:                       11 ms
32 sprites loaded + painted:          105 ms from script start
navigation domContentLoaded:          31 ms
first-paint 52 ms   first-contentful-paint 76 ms
32 sprite requests, encoded bytes:    32,677 B (32 KB)
median sprite request duration:       33.2 ms
```

Board fully populated in **105 ms** on the worst plausible transport. Sprite loading is not a
bottleneck and does not need an atlas, a preload manifest, or a loading screen.

#### A.2.4 Baked data bundle (measured, `probe_render_bundle.mjs`)

| Payload | raw | gzip | brotli |
|---|---|---|---|
| species, verbose JSON (naive) | 173.6 KB | 29.0 KB | 22.2 KB |
| species, **columnar JSON** | 30.4 KB | **12.0 KB** | 9.5 KB |
| species, binary (name blob + typed arrays) | 13.4 KB | 9.9 KB | 8.0 KB |
| moves, compact JSON (gen 9 std, 685) | 138.5 KB | 14.0 KB | 11.6 KB |
| moves, name+type+cat+bp+acc+pp only | 24.8 KB | **6.4 KB** | 5.6 KB |
| ability names (310) | 12.1 KB | 3.3 KB | 2.9 KB |
| item names (249) | 10.1 KB | 2.6 KB | 2.2 KB |
| typechart, 18×18 flat | 0.8 KB | **0.2 KB** | 0.1 KB |
| **learnsets, ids only (733 species)** | 642.8 KB | 70.5 KB | 48.9 KB |

Decisions:
- **Columnar JSON, not binary.** 12.0 vs 9.9 KB gzip is a 2 KB saving for a custom decoder, a
  build-order dependency, and a debugging tax. Not worth it. Ship columnar JSON; it stays greppable
  and diffable in review.
- **Scale the species table to 1025** (from 733): × 1.4 ⇒ ~17 KB gzip. Still trivial.
- **Learnsets are lazy.** 70 KB gzip is 40 % of the whole initial budget for data the board does not
  need until a move-selection UI opens. Separate chunk, dynamic `import()`, fetched during the draft.
- **`@pkmn/img` is a devDependency only.** It is 41 KB gzip at runtime, and all it does is compute a
  URL and a `background-position`. Bake both at build time; ship 0 KB.

Verified `@pkmn/img` output shape (`probe_rendersearch_img.mjs`) — note it is a *CSS* API, which is
another point for the DOM approach:

```
Icons.getPokemon('pikachu') ->
  style: "display:inline-block;width:40px;height:30px;image-rendering:pixelated;
          background:transparent url(.../pokemonicons-sheet.png) no-repeat scroll -40px -60px;"
  url, left:-40, top:-60
Sprites.getPokemon('pikachu',{gen:'gen5'}) -> {gen:5, w:96, h:96, url:.../gen5/pikachu.png, pixelated:true}
Icons.getItem('leftovers')  -> itemicons-sheet.png, 24x24, -48px -360px
Icons.getType('Fire')       -> types/Fire.png, 32x14 (178 B)
```
Icon sheet geometry: 40×30 cells, 12 columns (480 px wide), ≈2520 px tall.
**Do not use `types/*.png`** — render the 18 types as CSS pills with real text, for
accessibility and colour-blind labelling (see the Legibility recon).

#### A.2.5 Concrete KB budgets

**Tier 0 — initial load (first paint → playable hot-seat game).** Hard cap **250 KB** over the wire.

| Item | gzip |
|---|---|
| HTML + critical CSS | 8 KB |
| `react@19` + `react-dom@19` | 58 KB |
| App UI + engine + AI worker shim | 60 KB (budget) |
| Animation: WAAPI (0) or `motion/mini` | 0–3 KB |
| Data: species(1025) + typechart + moves-lite + ability/item names | 17 + 0.2 + 6.4 + 5.9 ≈ **30 KB** |
| 32 board sprites (measured) | **33 KB** |
| **Total** | **≈ 192 KB** — 23 % under cap |

**Tier 1 — per game beyond Tier 0.**

| Scenario | Additional bytes |
|---|---|
| New game, 32 new species, sprites uncached | **26 KB** |
| New game, species already cached | **0 KB** |
| Draft screen opened (icon sheet, once ever) | 383 KB |
| Move-selection UI opened (learnsets chunk) | 49 KB brotli / 70 KB gzip |
| Full move detail table (685 moves, all fields) | 11.6 KB brotli |

**Tier 2 — opt-in HD / animated.** Never automatic; a Settings toggle with the cost printed on it.

| Mode | per species | per 32-piece game | whole dex |
|---|---|---|---|
| `gen5` still (default) | 0.81 KB | 26 KB | 829 KB |
| `dex` 120×120 still ("HD") | 4.2 KB | 134 KB | ~4.2 MB |
| `ani` GIF ("Animated") | 61.9 KB (p95 146) | **1.98 MB** (p95 4.7 MB) | ~62 MB |

**Worst case, stated honestly:** a player who enables Animated and plays a 32-species game on a cold
cache downloads **~2.0 MB, p95 4.7 MB**. Mitigations: (a) HD/Animated fetch *per drafted species*
during the draft, which is a natural 20–60 s window; (b) a hard 6 MB per-session ceiling on the
animated cache, LRU-evicted; (c) if the drafted-team prefetch has not completed by the time the board
mounts, render the `gen5` still and hot-swap the GIF in on load — the still is already there, so
there is never a blank square. The 200 MB failure mode the Brief warns about only happens if you
vendor `ani/` for the whole dex; we never do.

#### A.2.6 Sizing, crispness and DPR

- Board 640×640 ⇒ 80 px squares. A 96×96 sprite drawn into an 80 px box is a **0.833× downscale** with
  `image-rendering: pixelated` — no blur, no upscaling artefacts. Verified visually.
- On a 2× DPR display, 80 CSS px = 160 device px, so the sprite is upscaled 1.67×. With
  `image-rendering: pixelated` ([MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/image-rendering))
  this reads as deliberate chunky pixel art, not as a low-res mistake. This is the single most
  important aesthetic decision in the asset plan: **commit to the pixel-art look** rather than fighting
  it, because the alternative (smooth HD) costs 5× the bytes and looks worse at 80 px anyway (the
  `dex/` row in my visual comparison was noticeably mushier).
- Sprite box: 80×80, `background-size: 80px 80px`, anchored bottom-centre with a 4 px lift so the
  Pokémon "stands" on the square. Larger species visually overflow their square slightly; allow it
  (`overflow: visible` on the board) — it reads as scale and is much better than uniform squashing.
  Verified in the screenshot comparison at both 80 px and native 96 px.
- Below ~44 px squares (small phones), swap the piece background to the **icon sheet** cell
  (40×30) — Showdown's icons are drawn for that size and stay legible where a downscaled 96 px
  sprite turns to mush. One CSS class swap, driven by a container query.

#### A.2.7 Licensing / attribution reality, and a stance

The measured facts:

- Pokémon names, sprites and artwork are © Nintendo / Creatures / GAME FREAK. No public licence grants
  redistribution.
- `smogon/pokemon-showdown-client` is AGPLv3 **for the code**, and the README states the repo
  "doesn't include several resource files (namely, the `/audio/` and `/sprites/` directories) for size
  reasons" — the art is deliberately *not in the repo* and carries no licence statement.
  ([repo](https://github.com/smogon/pokemon-showdown-client))
- `PokeAPI/sprites` has **no LICENSE file at all** — verified: `raw.githubusercontent.com/.../LICENSE`
  returns 404. PokéAPI's own docs state a fair-use policy ("locally cache resources whenever you
  request them") and say nothing about image licensing. ([PokéAPI docs](https://pokeapi.co/docs/v2))
- The *data* we depend on (`@pkmn/dex`, `@pkmn/data`) is MIT-licensed code+data from
  [pkmn/ps](https://github.com/pkmn/ps) and is safe to depend on and to bake.

**Recommended stance — three rules:**

1. **No Pokémon art in git, ever.** `.gitignore` already carries `public/sprites/` and the repo already
   anticipates `npm run vendor:sprites`. Keep it that way. The repo stays Apache-2.0-clean and
   contains only our own code plus MIT-licensed data.
2. **`scripts/vendor-sprites.ts`** downloads the 829 KB gen5 set (+ the 383 KB icon sheet) from
   Showdown into `public/sprites/`, with a checksum manifest, on the developer's or deployer's own
   machine. It is a build-time convenience, not redistribution by us. Document rate-limit politeness
   (concurrency 16, resume from disk cache — my probe did exactly this).
3. **The game must be fully playable with zero Pokémon assets.** Ship a **Type Glyph mode**: each piece
   renders as its chess glyph (♞ ♜ …) on a type-coloured hexagon with the type's 2-letter code, drawn
   in pure CSS/SVG. 0 KB, no third-party IP, WCAG-contrast-checked, and it is also the correct
   fallback for `prefers-reduced-data`, for offline first-run, and for anyone forking the repo. Make it
   a first-class visual option, not an error state — a designer should make it look intentional.
4. `ATTRIBUTION.md` naming Nintendo/Creatures/GAME FREAK, Smogon/Pokémon Showdown (sprites), the
   Smogon Sprite Project (the Gen-5-style sprites for post-Gen-5 species), pkmn/ps (MIT data), and a
   clear non-commercial, non-affiliated, fan-project statement with a takedown contact.

I am not a lawyer and this is not legal advice; this is the standard posture of every long-lived
Pokémon fan project and it is the minimum-risk option that still lets the game look good.

---

### A.3 VFX plan

The FX layer's job: make the type-matchup outcome **legible in under 300 ms** and satisfying without
becoming a cutscene. Every capture already costs a d6 roll, so the animation is the *reveal* of a
random outcome — it must feel like a slot machine landing, not a loading bar.

#### A.3.1 The five outcomes, specified

Total capture resolution is budgeted at **≤700 ms** in Normal speed. Anything longer and the game
stops feeling like chess.

| Phase | ms (Normal) | Layer | What is drawn |
|---|---|---|---|
| 0 — intent | 0 | DOM | attacker piece scales to 1.08, target square gains `.sq--targeted` ring |
| 1 — approach | 0–140 | DOM | attacker `translate3d` to target, `cubic-bezier(.34,1.4,.64,1)` overshoot |
| 2 — **die reveal** | 140–320 | Canvas | a 48 px d6 tumbles (6 frames of drawn pips) above the target square and lands; face 6 flashes gold, face 1 flashes red, 2–5 land grey and fade |
| 3 — **verdict** | 320–520 | Canvas | outcome-specific, below |
| 4 — settle | 520–700 | DOM | pieces removed / attacker seated; move list row appended; if extra move, board gains `.board--extra` glow and a "+1 MOVE" banner |

Verdict visuals (phase 3), all on the one canvas, all ≤1500 particles total:

| Outcome | Colour | Drawn | Sound | Words on screen |
|---|---|---|---|---|
| **Super effective** (type 2×, or die = 6 crit) | type colour of attacker, gold rim for crit | radial shockwave ring expanding 0→96 px + 240 burst particles + the attacking type's glyph stamped at 2× scale then shrinking | rising two-note sting | **"SUPER EFFECTIVE"** / **"CRITICAL HIT!"**, 2× line height, 180 ms punch-in |
| **Not very effective** (type ½×) | desaturated slate | both sprites crack: 2 grey shatter fans of 90 particles each, drifting *apart* | dull thud, downward | **"NOT VERY EFFECTIVE — BOTH FALL"** |
| **Miss** (die = 1) | red | red X drawn as two 6 px strokes over the target, 120 particles falling straight down under gravity | descending buzz | **"MISS — BOTH FALL"** |
| **Immune** (0×) — *never animates* | — | move is illegal; on hover the target square shows a dashed grey ring + a `NO EFFECT` tooltip, and clicking it plays a 60 ms shake with no state change | soft "nope" click | **"NO EFFECT"** tooltip only |
| **Neutral** | neutral white | 60-particle puff, no shockwave, target fades over 120 ms | short click | none |

Design rules that make it legible rather than noisy:

1. **Colour is redundant, never primary.** Every outcome also has distinct *motion* (outward
   shockwave vs. bidirectional shatter vs. downward gravity vs. no motion), distinct *sound*, and
   distinct *text*. A colour-blind player, a muted player, and a player who blinked all still get it.
2. **Text is DOM, not canvas.** The verdict banner is a real `aria-live="assertive"` element so screen
   readers announce "Super effective. Charizard captures Venusaur. Extra move." The canvas is
   `aria-hidden="true"` and carries zero information that is not also in the DOM.
3. **Immunity gets pre-emptive feedback, not post-hoc.** The single worst legibility failure in the
   original rules is discovering mid-attempt that Ground cannot take Flying. On piece selection, the
   engine's legal-move list already knows: illegal-by-type squares render with a distinct dashed
   "no effect" affordance from the moment you pick the piece up. **Nothing about immunity is ever a
   surprise.** (Measured: only **8** of 324 ordered single-type pairs are 0× — see §B.3.2 — so this
   affordance is rare enough to feel special and common enough to matter.)
4. **Extra-move chains stack, they don't replay.** A chain of 2 extra moves does not play the full
   700 ms three times: the second and third links skip phase 0 and compress to 420 ms, and the "+1
   MOVE" banner increments rather than re-animating. Chain cap is 2 (§B.2.4), so the worst case is
   700 + 420 + 420 = **1540 ms**.
5. **One particle budget.** A global cap of 1500 live particles, allocated from a preallocated
   `Float32Array` ring buffer (x, y, vx, vy, life, size, hue = 7 floats × 1500 = 42 KB, zero GC
   pressure). Measured cost at 2000 particles: 0.42 ms/frame. New effects that would exceed the cap
   evict the oldest, so simultaneous FX degrade gracefully instead of dropping frames.

#### A.3.2 Three speed modes

A single `animationSpeed` setting in the store, read by both the DOM animation controller and the FX
loop. Not a global CSS multiplier — each phase gets an explicit duration table.

| Mode | Capture total | Piece slide | Die reveal | Particles | Notes |
|---|---|---|---|---|---|
| **Cinematic** | 1000 ms | 200 ms | 300 ms | 1500 | default for first 3 games (tutorial feel), then offer to speed up |
| **Normal** (default) | 700 ms | 140 ms | 180 ms | 1500 | the table above |
| **Fast** | 260 ms | 80 ms | **0 ms — result shown instantly** | 300 | verdict text + a single 100 ms flash. No die tumble. |
| **Instant** | 0 ms | 0 ms | 0 ms | 0 | position snaps; verdict appears in the move list and in the `aria-live` region only |

**Fast mode is not "Normal but shorter".** It removes the *suspense* phase entirely (the die is
already resolved by the engine; the tumble is pure theatre) and keeps only the information. That is
what a player on their 200th game actually wants. Bind it to a held modifier too:
holding <kbd>Shift</kbd> while committing a move plays that one move at Instant speed.

#### A.3.3 Reduced motion

`@media (prefers-reduced-motion: reduce)`
([MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion)) is honoured at
two levels, and the setting is also exposed manually because OS-level preference is coarse.

The reduced-motion path is **not** "Instant". Instant destroys the game's feedback loop. Instead:

| Removed | Kept |
|---|---|
| all particles (canvas layer never starts its rAF loop) | verdict banner, held **900 ms** instead of 400 |
| die tumble animation | die *result* rendered as a static pip face, held 500 ms |
| screen shake, board glow, overshoot easing | a 2 px static outline pulse — one step, not a loop |
| piece slide (position changes discretely) | 160 ms cross-fade so the eye can follow which piece moved |
| capture-chain replays | "+1 MOVE" as static text |

Implementation: `matchMedia('(prefers-reduced-motion: reduce)')` sets a store flag; the FX renderer
short-circuits to a `StaticRenderer` that draws nothing and the DOM controller uses the
`reducedDurations` table. **Test it**: a Vitest case asserting `FxQueue.enqueue()` produces zero
canvas draw calls when the flag is set, plus one Playwright run with the media feature emulated.

---

### A.4 Performance budgets we will hold the implementation to

These are CI-enforceable gates, not aspirations. Each row names the enforcement mechanism.

| Metric | Target | Fail build at | Measured today / basis | Enforced by |
|---|---|---|---|---|
| **Initial JS+CSS, gzip** | ≤ 180 KB | 200 KB | 126 KB accounted (React 58 + app budget 60 + anim 3 + html/css 8) | `size-limit` on the Vite output, per-chunk |
| **Initial data, gzip** | ≤ 32 KB | 40 KB | ~30 KB measured/scaled | `size-limit` on `src/data/generated/*` |
| **Total first-game bytes** | ≤ 250 KB | 300 KB | ~192 KB | Playwright: sum `resource` transferSize to first playable |
| **Lazy chunks** | learnsets ≤ 80 KB; icon sheet ≤ 400 KB | — | 70 KB gz / 383 KB | `size-limit` |
| **FCP, localhost** | ≤ 300 ms | 600 ms | **76 ms** measured | Playwright `paint` entries |
| **Board fully painted (32 sprites)** | ≤ 500 ms | 1000 ms | **105 ms** measured (HTTP/1.1) | Playwright, in CI |
| **TTI / interactive** | ≤ 1.5 s on simulated Slow-4G + 4× CPU throttle | 3.0 s | not yet measured | Lighthouse CI ([TTI](https://developer.chrome.com/docs/lighthouse/performance/interactive)) |
| **Main-thread script per animating frame** | p95 ≤ 4.5 ms | 8 ms | **0.5 ms** measured | Playwright long-animation trace, p95 of `performance.measure` |
| **Dropped frames during a capture animation** | 0 at 60 Hz | >2 | — | Playwright `requestAnimationFrame` delta histogram |
| **INP on square click** | ≤ 100 ms | 200 ms | — | Playwright + `PerformanceObserver` |
| **Live particles** | ≤ 1500 | hard clamp in code | 2000 measured at 0.42 ms | runtime assert in dev builds |
| **JS heap after 100 moves** | ≤ 60 MB | 120 MB | — | Playwright `performance.measureUserAgentSpecificMemory()`; also asserts no growth ≥5 MB over moves 50→100 (leak gate) |
| **Engine: legal-move generation, one position** | ≤ 1.0 ms | 3 ms | movegen measured at **8.5 M legal-nodes/s** (perft(5) = 4,865,351 in 598 ms) ⇒ ~0.004 ms/position | Vitest benchmark, `--fail-on-regress 20 %` |
| **Engine: perft correctness** | perft(1..5) exact | any mismatch | perft(5)=4,865,351 ✓ | Vitest, plus `chess.js` differential test |
| **AI: think time, Normal difficulty** | p50 700 ms, **p95 ≤ 1200 ms** | 2000 ms | see §B.5 | Vitest bench over 200 stored positions |
| **AI: worker never blocks UI** | main-thread block from AI = 0 ms | >16 ms | — | Playwright: assert no long task while AI thinks |
| **Bundle has no `@pkmn/*` at runtime** | 0 bytes | any | — | `rollup-plugin-visualizer` assertion in CI |

Two budgets deserve comment:

- **The memory-leak gate matters more than the absolute cap.** A chess UI that leaks 500 KB per move
  is fine for 10 moves and dead at move 300. Assert *no growth*, not just a ceiling.
- **AI p95, not p50.** An AI that averages 400 ms but occasionally takes 6 s feels broken. Iterative
  deepening with a hard wall-clock abort (§B.4.4) makes p95 a *contract*, not a hope.

---

### A.5 File layout for the rendering half

```
src/
  ui/
    board/
      Board.tsx            # 64 <button class=sq>, React, renders once per position
      Piece.tsx            # one div, background-image, no state
      squares.ts           # square <-> pixel math, single source of truth
      Board.module.css
    fx/
      FxQueue.ts           # pure: enqueue(FxEvent) -> deterministic particle emissions
      Renderer.ts          # interface { draw(dt): void }  <-- swap point for future WebGL
      Canvas2DRenderer.ts  # the one implementation
      StaticRenderer.ts    # prefers-reduced-motion: draws nothing
      particles.ts         # Float32Array ring buffer, cap 1500
      effects/             # oneOf: superEffective.ts, mutual.ts, miss.ts, neutral.ts, die.ts
    anim/
      MoveAnimator.ts      # WAAPI; owns durations table per speed mode
      durations.ts         # cinematic | normal | fast | instant | reduced
    sprites/
      spriteUrl.ts         # generated: id -> '/sprites/gen5/<id>.png' (baked, no @pkmn/img)
      iconOffsets.ts       # generated: id -> [left, top] into pokemonicons-sheet.png
      glyphMode.ts         # Type Glyph fallback renderer, 0 assets
scripts/
  vendor-sprites.ts        # downloads 829 KB + 383 KB into public/sprites/, checksummed
  gen-data.ts              # already exists; extend to emit spriteUrl/iconOffsets
public/
  sprites/                 # GITIGNORED. never committed.
```

`FxQueue` being pure and deterministic is deliberate: it lets a Vitest test assert "a super-effective
capture with seed 7 emits exactly 240 particles with these initial velocities", which is the only way
FX code stays testable.

---

## PART B — AI OPPONENT

### B.1 Why no off-the-shelf engine, and what survives

#### B.1.1 Stockfish

Stockfish is not a "chess reasoner" you can point at a board. It is a program whose every layer
assumes the rules of chess as a compile-time constant:

1. **Bitboards.** Move generation is `magic bitboards` over `U64` masks precomputed for exactly 64
   squares and exactly 6 piece types. Our pieces have a *type* (18 values) and a per-pair capture
   legality relation. There is no bitboard formulation of "this rook may not capture that bishop
   because Ground cannot hit Flying" — legality depends on the pair, which is not expressible as a
   per-piece attack mask.
2. **NNUE evaluation.** The network's input features are (king square × piece × square) tuples.
   A Pokémon's type, status, HP and item are simply not in the input space. Retraining is not
   "configuration"; it is generating billions of self-play positions for a game whose rules do not
   exist yet.
3. **Determinism.** The search assumes `makeMove` is a function. Ours is a distribution: the same
   move produces capture, mutual destruction, or capture-plus-extra-move depending on a d6. There is
   no chance-node concept anywhere in Stockfish's search.
4. **UCI cannot express our position.** UCI transmits `position fen <FEN> moves ...`
   ([UCI](https://www.chessprogramming.org/UCI)). FEN has 12 piece symbols. Encoding 18 types × 6
   classes × status × HP × item requires extending FEN, which the engine will reject. There is no
   UCI field for "it is still my turn because I got a free move."

**Could we use Stockfish for pure-chess sub-positions?** No, and the reason is worth stating because
it looks tempting. A sub-position is only "pure chess" if no capture will ever be type-affected — but
every piece carries a type permanently, so *every* capture in *every* line is stochastic and
type-gated. There is no subtree of the game that is standard chess. Even the pawn-storm endgame where
no capture is currently available is not pure: Stockfish's evaluation would price a passed pawn's
promotion race using standard piece values, while in our game a Bug-type queen is worth ~0.86× and a
Steel-type queen ~1.15× (measured, §B.3.2), and a Ghost-type king may be literally uncapturable by
half the enemy army. Its answers would be confidently wrong in exactly the positions where type
knowledge is supposed to decide the game — i.e. it would destroy the entire premise.

The narrow exception where Stockfish *is* usable: as an **offline analysis tool during development**,
to sanity-check that our engine's plain-chess move generation and our search's basic tactical
competence are not broken, on positions we have deliberately constructed to be type-neutral
(all 32 pieces the same type ⇒ every capture is 1×). That is a test harness, not a feature.
`chess.js` ([repo](https://github.com/jhlywa/chess.js)) already covers legality; Stockfish would only
add "is our eval sane", which our own self-play covers more cheaply.

#### B.1.2 Fairy-Stockfish

Fairy-Stockfish is the strongest candidate and it still fails. Its `variants.ini` is a **fixed
declarative parameter list**, not a scripting language. I read the variant-configuration
documentation ([wiki](https://github.com/fairy-stockfish/Fairy-Stockfish/wiki/Variant-configuration))
and enumerated what it exposes: piece definitions (Betza notation), board geometry, `startFen`,
pawn double/triple-step regions, castling, promotion, drops/pockets, `mustCapture`, `checking`, and
win conditions (`checkmateValue`, `extinctionValue`, `flagPiece`, `nMoveRule`, `nFoldRule`, …).

Against our four core mechanics:

| Our mechanic | Expressible in `variants.ini`? |
|---|---|
| d6 randomness on capture | **No.** Every option is deterministic. There is no chance-node machinery in the search at all. |
| Mutual destruction (both pieces removed) | **No.** Nothing parameterises capture *resolution*. Atomic chess explodes neighbours, but that is hard-coded C++, not configurable. |
| Super-effective ⇒ extra move | **No.** Turn alternation is not parameterised. |
| Capture legality depends on the (attacker, defender) *pair* | **No.** Betza notation restricts what a piece captures *like* (`b:mWBcB`, `q:cQ`), and mobility regions restrict *where* — never *which enemy*. |

Even a C++ fork would need a new chance-node search, a new evaluation, and a new
position representation — i.e. the whole engine — while inheriting 100 k lines of chess-specific
assumptions, a build toolchain we do not want (Emscripten →
[stockfish.wasm](https://github.com/lichess-org/stockfish.wasm) needs SharedArrayBuffer, hence
COOP/COEP headers, which breaks static hosting), and a GPL licence that conflicts with the repo's
Apache-2.0.

#### B.1.3 What is salvageable

Ideas, not code. All of these are ~50–200 lines each in TS and all of them survive our rule changes:

- Iterative deepening with aspiration windows ([CPW](https://www.chessprogramming.org/Iterative_Deepening))
- Transposition table with Zobrist keys ([CPW](https://www.chessprogramming.org/Zobrist_Hashing),
  [CPW](https://www.chessprogramming.org/Transposition_Table)) — extended, see §B.4.3
- Quiescence search ([CPW](https://www.chessprogramming.org/Quiescence_Search)) — redefined, see §B.2.5
- MVV-LVA + killer moves + history heuristic for ordering
- Late move reductions ([CPW](https://www.chessprogramming.org/Late_Move_Reductions))
- Piece-square tables, mobility, king safety as eval terms
- 0x88 board representation. **Already validated here**: my probe's 0x88 generator produces
  `perft(5) = 4,865,351` — the exact published value — at 8.5 M legal-nodes/s in plain JS.

---

### B.2 Search architecture

#### B.2.1 The problem, quantified

I built a full working prototype: a 0x88 alpha-beta negamax with MVV-LVA ordering, a synthetic
18-type assignment per square, a synthetic 18×18 effectiveness table matched to the real
distribution (2.5 % 0×, 18.8 % ½×, 63 % 1×, 15.7 % 2×), the d6 rule, mutual destruction, illegal
captures, and extra-move chains capped at 2. Then I measured six ways of handling the chance node
(`probe_rendersearch_search.mjs`). Nodes and wall-clock, Node v24 on this machine:

**From the initial position** (0 captures available — the easy case):

| mode | d4 | d5 | d6 | d7 |
|---|---|---|---|---|
| **P** plain chess (no variant rules) | 1,435 n / 6 ms | 24,600 / 21 | 297,311 / 97 | 967,838 / 328 |
| **A** chance nodes, α/β passed through to children (unsound) | 1,615 / 2 | 62,944 / 27 | 223,918 / 86 | 7,595,508 / 2979 |
| **B** chance nodes, full window at children (sound) | 210,618 / 63 | 5,314,468 / 1951 | **135,399,968 / 40,265** | — |
| **G** collapse to modal outcome (deterministic) | 1,472 / 2 | 24,960 / 12 | 328,106 / 130 | 4,043,780 / 1712 |
| **H** single sampled outcome | 1,451 / 2 | 20,459 / 10 | 51,801 / 23 | 1,711,403 / 734 |
| **I** star1 with ±900 cp eval bounds | 1,609 / 2 | 65,245 / 30 | 810,920 / 289 | 6,454,932 / 2582 |

**From a middlegame position** (4 captures available — the realistic case):

| mode | d4 | d5 | d6 | d7 |
|---|---|---|---|---|
| **P** plain chess | 2,610 n / 2 ms | 19,828 / 13 | 45,161 / 31 | 578,878 / 314 |
| **A** unsound α/β pass-through | 84,221 / 39 | 500,753 / 316 | 4,817,330 / 2059 | 40,893,331 / 16,892 |
| **B** sound full-window | 4,379,122 / 1377 | **186,867,880 / 65,455** | — | — |
| **G** modal collapse | 2,554 / 2 | 17,258 / 12 | **42,943 / 34** | 408,683 / 210 |
| **H** single sample | 3,800 / 4 | 26,857 / 18 | 75,691 / 44 | 618,019 / 304 |
| **I** star1, ±900 bounds | 41,977 / 18 | 661,608 / 268 | 7,351,339 / 3030 | 112,783,446 / 44,944 |

Read the middlegame depth-6 column: plain chess **45 k nodes / 31 ms**; sound expectiminimax is
already at **187 M nodes / 65 s at depth 5**; collapsed search is **43 k / 34 ms** — the *same cost as
plain chess*. And an earlier run (`probe_render_star2.mjs`, `probe_render_modeE.mjs`) isolated the
extra-move chain cost: at depth 7 from the start, chains capped at 2 = 12.86 M nodes, capped at 1 =
11.87 M, banned = 8.38 M — chains cost **+53 %**, not a blow-up.

#### B.2.2 star1/star2 is a trap here — and this is the counter-intuitive finding

The textbook answer to chance nodes is Ballard's \*-minimax
(Ballard, B. W., "The \*-minimax search procedure for trees containing chance nodes",
*Artificial Intelligence* 21(3):327–350, 1983; see also Hauk, Buro & Schaeffer, "Rediscovering
\*-Minimax Search", *Computers and Games* 2006, LNCS 3846,
[Springer](https://link.springer.com/chapter/10.1007/11922155_3), and
[Wikipedia: Expectiminimax](https://en.wikipedia.org/wiki/Expectiminimax)).

**It makes our search slower.** Measured, from the initial position at depth 7:

```
B  sound, no pruning at chance children      12,863,796 nodes / 3,983 ms
C  star1 with running bounds (±3000 cp)      22,285,750 nodes / 6,907 ms   <-- 1.7x WORSE
```

and at middlegame depth 6, `I` (star1, tighter ±900 bounds) is 7.35 M nodes vs `A`'s 4.82 M —
still worse than doing nothing clever.

The reason is structural, and it is visible in the star1 formula itself. Wikipedia states it as
`αᵢ = N·α − (v₁+…+vᵢ₋₁) + U·(n−i)`, with `L`/`U` the **global** bounds on any leaf value. Two of our
properties break it:

1. **`n` is tiny.** Our chance node has **2 or 3 children**, never 21 like backgammon's dice rolls.
   Star1's win comes from cutting off child 3 of 21; with 3 children the best case is skipping one.
2. **`U − L` is huge relative to `β − α`.** With material-based eval, `U − L` must cover at least
   ±queen, realistically ±mate. Substituting `N=3`, `U=+3000`, `L=−3000` into the formula gives a child
   window *wider than* `[α, β]`. So star1 doesn't just fail to cut — it **widens the window it passes
   down**, destroying the ordinary alpha-beta pruning inside each child's subtree. That is exactly the
   1.7× regression I measured.

Star1/star2 need many chance outcomes and tight value bounds. We have few outcomes and loose bounds.
**Do not implement star1.** This is the single most expensive wrong turn available in this project,
and it is the one a competent implementer reading the literature would take.

#### B.2.3 The recommended architecture: Collapsed-Interior / Exact-Root

```
pickMove(position, timeBudget):
  for depth in 1..MAX:                              # iterative deepening
    for each root move m (ordered: TT move, then MVV-LVA, then history):
      if m is a capture:
         # EXACT chance expansion, root only: 2-3 children
         value(m) = Σ_outcome  P(outcome) · negamax(apply(m, outcome), depth-1, ...)
      else:
         value(m) = negamax(apply(m), depth-1, ...)
    if elapsed > timeBudget: break                  # keep last completed depth's best move
  return argmax value

negamax(pos, depth, α, β):                          # INTERIOR: fully deterministic
  ... standard alpha-beta ...
  for each move m:
    if m is a capture:
       if effectiveness(attacker, defender) == 0: continue          # illegal, prune entirely
       outcomes = chanceOutcomes(m)                                  # 2 or 3, with probabilities
       modal    = argmax_p outcomes                                  # the ≥4/6 branch
       bias     = Σ_o P(o)·materialDelta(o)  −  materialDelta(modal)  # static EV correction, cheap
       child    = apply(m, modal)                                    # ONE successor
       v        = (modal grants extra move && chain < 2)
                    ? +negamax(child, depth-1, α, β)                 # same side to move
                    : -negamax(child, depth-1, -β, -α)
       v += bias
    else:
       v = -negamax(apply(m), depth-1, -β, -α)
    ... normal α/β update, TT store, cutoffs ...
```

Three claims, each measured.

**Claim 1 — interior exactness buys nothing.** I built the full variant game (real d6 rolls, mutual
destruction, illegal captures, extra-move chains, promotion, king-capture termination) and ran an
**equal-node-budget match** between the sound interior agent (`A`) and the collapsed interior agent
(`J` = modal collapse + static EV bias). *Both* agents use exact chance expansion at the root, so the
experiment isolates the interior treatment. Both run iterative deepening until the node budget is
spent (`probe_rendersearch_selfplay.mjs`):

```
budget = 40,000 nodes/move,  80 games:  J 37 – 25 A, 18 draws  -> J scores 57 %   (avg 93 plies)
budget = 150,000 nodes/move, 40 games:  J 14 – 17 A,  9 draws  -> J scores 46 %   (avg 96 plies)
pooled, 120 games:                                                J scores 53.8 % ± 4.6 % (1 s.e.)
```

Not a significant difference. **Exact interior chance-node averaging is worth ~0 Elo at equal
budget** — and it costs 100–4000× more nodes per depth (§B.2.1), which means far worse worst-case
latency and a completely unusable time-management story. Collapse.

**Claim 2 — root exactness is free and worth keeping.** The root has ~30 moves × ≤3 outcomes; the
cost is one extra depth-1 subtree per capture. Measured overhead: root-exact + collapsed interior
cost 500,623 nodes vs 452,768 for fully-collapsed (`probe_rendersearch_agree.mjs`) — **+11 %**. And it
matters qualitatively: the *decision the player sees* is the one that correctly prices "1/6 chance I
lose my queen for nothing." An AI that walks into a coin-flip it could have avoided reads as stupid
in a way that a slightly weaker deep line does not.

**Claim 3 — the static EV bias is the important half of the collapse.** Naive modal collapse (`G`)
systematically over-values captures (it always assumes the likely-good branch and never pays for the
1/6 miss): at midgame depth 7, `G` scored the position at +1012 while sound `A` said +1906 — biased,
and biased *inconsistently*. Adding `bias = Σ P(o)·Δmaterial(o) − Δmaterial(modal)` prices the tail
outcomes with one multiply-add per capture and no extra nodes. Root-move agreement with the sound
search at fixed depth 4 over 24 random positions: `G` 42 %, `J` 46 %, root-hybrid 54 % (top-3
agreement `G` 63 %, `J` 67 %). The agreement is low in absolute terms because random positions have
many near-equal moves — but `J > G` consistently, and the self-play result above is the number that
actually decides it.

**Rejected alternatives, with reasons:**

- **Full expectiminimax (mode B).** 187 M nodes at depth 5. Not a candidate.
- **star1/star2 (modes C, I).** Slower than doing nothing here. §B.2.2.
- **Unsound α/β pass-through at chance children (mode A).** Tempting because it is a 3-line change
  from B, but it is *wrong* (a child's value can legitimately lie outside the parent window while the
  average does not), it still costs 100× at depth 6, and it buys no strength (Claim 1).
- **Single-sample chance nodes (mode H).** Cheapest of all (75 k nodes at midgame d6) but introduces
  search *variance*: the same position searched twice gives different answers, which breaks the
  transposition table, breaks reproducibility (the Brief demands a deterministic engine), and makes
  bugs unreproducible. Use it only as a deliberate "Chaotic" personality (§B.5), never as the default.
- **MCTS / UCT.** Genuinely attractive on paper: chance nodes are free (you just sample), extra-move
  chains are free (they are just longer rollouts), and it handles the branching factor naturally
  ([CPW: MCTS](https://www.chessprogramming.org/Monte-Carlo_Tree_Search)). It loses for three
  concrete reasons. (i) **Random rollouts are worthless in chess-like games** — the classic result;
  a random playout from a won position throws the win away, so you need a strong policy/value net,
  which we do not have and cannot train without a finished ruleset. (ii) **Tactics.** Our game is
  *sharper* than chess, not softer: a single missed super-effective capture chain can be losing, and
  UCT's averaging notoriously under-weights single narrow refutations. (iii) **Latency profile.** MCTS
  gives a usable answer at any time, which is nice, but at our budget (≈500 k nodes) alpha-beta with
  a decent eval reaches depth 6–7, and depth is what punishes a human's tactical errors. Revisit MCTS
  only if a v3 adds a learned value function.
- **Flat Monte Carlo** (sample each root move N times to a fixed depth with random play): strictly
  dominated by the above. It cannot see forced sequences at all. Its only virtue is that it is 40 lines
  — which makes it a fine *baseline opponent for testing* our real AI's strength, and nothing else.

#### B.2.4 What a "ply" means, and why the game terminates

An extra move is **not a new turn**. In the search it is a child at `depth − 1` with the *same side to
move* and no negation:

```
v = +negamax(child, depth − 1, α, β)     // extra move: same player, same window sign
v = -negamax(child, depth − 1, -β, -α)   // normal: opponent to move
```

This is the correct formulation because search depth measures *decisions*, and an extra move is a
decision. It also gives the termination bound for free:

- **Chain cap = 2.** A single turn is at most 3 board moves (initial + 2 extras).
- Each link in a chain is *necessarily a capture* (only captures roll dice), so each link removes at
  least one enemy piece. With 16 enemy pieces, the total number of chain links in an entire game is
  ≤16 regardless of the cap — but the per-turn cap is what makes the *search* depth-bounded and the
  *animation* time-bounded (§A.3.1: worst case 1540 ms).
- Measured cost of the cap: banning chains 8.38 M nodes → cap 1: 11.87 M → cap 2: 12.86 M at depth 7.
  **Cap 2 costs +53 % over banning them.** Affordable, and cap 3+ is not worth measuring because the
  UX (a 2+ second uninterruptible enemy turn) is already at its limit.
- In the deepest self-play games the maximum observed chain length was tracked and never exceeded the
  cap, i.e. the cap binds rather than being decorative.

*This section only addresses the search's need for a bound. The game-rules argument for why chains
terminate (and the check/checkmate/mutual-destruction model) belongs to the rules recon; the search
requires only that a turn has a compile-time maximum number of decisions, which the cap of 2
guarantees.*

#### B.2.5 Quiescence, redefined

Standard quiescence extends the search over captures until the position is "quiet". Our version needs
two changes:

1. **A capture is not a stable evaluation point.** After a capture there is a ⅙ chance the attacker is
   also gone. So the quiescence node must use the *collapsed + EV-biased* value, not the raw material
   swing. Reuse the same `bias` term.
2. **Mutual destruction makes bad trades cheap** (the Brief's "suicide-capture as a tactic"). Standard
   SEE (static exchange evaluation) is therefore wrong: capturing a queen with a pawn when the type
   matchup is ½× is a *good* trade in our game (you spend a pawn to guarantee a queen dies). So
   quiescence must **not** prune "losing" captures by SEE. Instead prune by *expected* material:
   `EΔ = Σ P(o)·Δmaterial(o)`, and search any capture with `EΔ > −0.5 pawn`. That single change is
   what will make the AI play the variant rather than play chess badly.
3. Depth limit 6 quiescence plies, and **captures granting extra moves are searched in quiescence**
   (they are the sharpest tactic in the game).

---

### B.3 Evaluation function

#### B.3.1 The sketch

All terms are computed for the side to move minus the opponent, in centipawn-equivalents.

```
eval(pos) =
    Σ_p  side(p) · pieceValue(p, pos)            // material, type-aware
  + Σ_p  side(p) · pst[class(p)][sq(p)][phase]   // piece-square tables
  + W_MOB · Δ mobility                           // legal moves, capped per piece
  + W_KS  · Δ kingSafety
  + W_COV · Δ typeCoverage                       // vs the ENEMY's actual army  <-- the variant's soul
  + W_THR · Δ superEffectiveThreats              // SE captures available next move
  - W_VUL · Δ superEffectiveVulnerability        // SE captures the enemy has on us
  + W_IMM · Δ immunityShield                     // our pieces no enemy piece can legally take
  + W_TMP · tempoBonus                           // small, side-to-move
  + W_STA · Δ statusScore                        // v2: burn/para/sleep on pieces
  + W_HAZ · Δ hazardScore                        // v2: spikes-style square effects
```

with

```
pieceValue(p, pos) = baseValue[class(p)] · typeMultiplier(type(p)) · (1 + 0.15·armyFit(p, pos))

baseValue = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 20000 }   // measured-prototype values

typeMultiplier(t)  = static, precomputed from the 18×18 chart (table in B.3.2)

armyFit(p, pos)    = normalised count of ENEMY pieces this piece can hit super-effectively,
                     weighted by their value:
                     Σ_{e ∈ enemy} value(e) · [eff(type(p), type(e)) == 2]
                     −  Σ_{e ∈ enemy} value(e) · [eff(type(p), type(e)) == 0]      // dead weight
                     all over Σ_{e} value(e)
```

Term definitions, concretely:

| Term | Definition | Suggested weight | Why |
|---|---|---|---|
| `typeCoverage` | number of the 18 types the army holds ≥1 piece that hits 2× | 12 per type covered | rewards a broad draft; punishes mono-type armies |
| `superEffectiveThreats` | Σ over (our piece, enemy piece) pairs where the capture is *available this move* and 2×, of `0.35 · value(enemy)` | 1.0 | 0.35 ≈ P(extra move) − P(mutual) from the measured table (§B.3.2), so the term is calibrated, not invented |
| `superEffectiveVulnerability` | same, with colours swapped | 1.2 | asymmetric: fear beats greed, standard in chess evals |
| `immunityShield` | Σ over our pieces of `0.10 · value(p)` if **no** enemy piece has a legal capture of `p` by type, else 0 | 1.0 | prices the Brief's "untouchable Flying piece" problem into the eval instead of leaving it as a rules exploit |
| `mobility` | legal destination count per piece, capped at 8 per piece, **counting type-illegal captures as 0** | 3 per move | must use *variant* mobility, or the AI over-values a Ground rook staring at a Flying wall |
| `kingSafety` | pawn-shield count + attacker count on the 8 king-adjacent squares, **× (1 − immunityFraction(king))** | −25 per attacker | a Ghost king attacked only by Normal/Fighting pieces is *not* in danger — this is the term that makes type knowledge feel powerful |

**Design judgement I want on record:** the static per-type multiplier has a measured spread of only
**±15 %** (§B.3.2). That means a naive "Steel pieces are worth more" eval is a *small* correction.
The terms that actually carry the variant — `armyFit`, `typeCoverage`, `superEffectiveThreats`,
`immunityShield`, and the king-safety immunity discount — are all **relational**: they depend on
*which types the opponent drafted*. That is the correct shape for this game, because it is what makes
"I know types" convert into "I win": the strong player reads *this* enemy army, not a type tier list.
If you implement only one non-chess eval term, implement `superEffectiveVulnerability`.

#### B.3.2 The type table, computed from the real Gen 9 chart

`probe_rendersearch_typevalue.mjs`, real `@pkmn/data` type chart, against single-type defenders,
including the d6 (P(crit) = P(miss) = 1/6):

| type | ATK 2× / 1× / ½× / 0× | DEF 2× / 1× / ½× / 0× | P(extra move) | P(mutual kill) | P(illegal) | P(survive an attack) |
|---|---|---|---|---|---|---|
| Fighting | 5 / 7 / 5 / 1 | 3 / 12 / 3 / 0 | .363 | .363 | .056 | .278 |
| Ground | 5 / 10 / 2 / 1 | 3 / 12 / 2 / 1 | **.363** | .245 | .056 | .287 |
| Fire | 4 / 10 / 4 / 0 | 3 / 9 / 6 / 0 | .315 | .315 | 0 | .389 |
| Ice | 4 / 10 / 4 / 0 | 4 / 13 / 1 / 0 | .315 | .315 | 0 | **.204** |
| Rock | 4 / 11 / 3 / 0 | 5 / 9 / 4 / 0 | .315 | .278 | 0 | .315 |
| Water | 3 / 12 / 3 / 0 | 2 / 12 / 4 / 0 | .278 | .278 | 0 | .315 |
| Grass | 3 / 8 / 7 / 0 | 5 / 9 / 4 / 0 | .278 | **.426** | 0 | .315 |
| Flying | 3 / 12 / 3 / 0 | 3 / 11 / 3 / 1 | .278 | .278 | 0 | .324 |
| Bug | 3 / 8 / 7 / 0 | 3 / 12 / 3 / 0 | .278 | **.426** | 0 | .278 |
| Steel | 3 / 11 / 4 / 0 | 3 / **4** / **10** / 1 | .278 | .315 | 0 | **.583** |
| Fairy | 3 / 12 / 3 / 0 | 2 / 12 / 3 / 1 | .278 | .278 | 0 | .324 |
| Electric | 2 / 12 / 3 / 1 | 1 / 14 / 3 / 0 | .245 | .284 | .056 | .278 |
| Poison | 2 / 11 / 4 / 1 | 2 / 11 / 5 / 0 | .245 | .324 | .056 | .352 |
| Psychic | 2 / 13 / 2 / 1 | 3 / 13 / 2 / 0 | .245 | .245 | .056 | .241 |
| Ghost | 2 / 14 / 1 / 1 | 2 / 12 / 2 / **2** | .245 | **.206** | .056 | .333 |
| Dark | 2 / 13 / 3 / 0 | 3 / 12 / 2 / 1 | .241 | .278 | 0 | .287 |
| Dragon | 1 / 15 / 1 / 1 | 3 / 11 / 4 / 0 | .206 | .206 | .056 | .315 |
| Normal | **0** / 15 / 2 / 1 | 1 / 16 / 0 / 1 | **.167** | .245 | .056 | .213 |

Derived scalar for `typeMultiplier`, using
`1 + 0.9·(P_extra − μ) − 0.9·(P_mutual − μ) + 0.6·(P_survive − μ)`:

```
Steel 1.148  Ground 1.109  Ghost 1.066  Fire 1.064  Rock 1.053  Flying 1.025  Fairy 1.025
Water 1.020  Dragon 1.020  Fighting 0.998  Psychic 0.975  Poison 0.971  Dark 0.970
Electric 0.962  Ice 0.953  Normal 0.888  Grass 0.887  Bug 0.864
spread: Steel 1.148 -> Bug 0.864  (33 % top-to-bottom)
```

The complete illegal-capture relation — **8 ordered pairs out of 324 (2.5 %)**:

```
Normal→Ghost, Ghost→Normal, Fighting→Ghost, Electric→Ground,
Ground→Flying, Psychic→Dark, Poison→Steel, Dragon→Fairy
```

Three balance facts that fall straight out of this table and that the balance/rules design should use:

1. **The die dominates the type chart.** For *any* attacker, P(crit) + P(miss) = 1/3. Roughly a third
   of every capture is decided by the d6 alone, and no type has P(extra move) above .363 or below
   .167. The RNG is doing more work than the types — which is exactly the video's stated intent
   ("the mechanic that lets the worse player win"), but it means **type knowledge is worth less than
   the concept implies** unless the rules amplify it (e.g. re-roll on 2× matchup, or crit only on 2×).
2. **Steel is the best defensive type by a mile** (resists 10, immune to 1, P(survive) = .583, 2.9×
   Ice's .204). Expect Steel to be the first pick in every draft. Either accept it as a known meta or
   add a draft constraint.
3. **Grass and Bug are traps** (P(mutual kill) = .426 — they suicide on almost half their attacks) and
   **Normal cannot super-effectively hit anything at all** (0 of 18). A draft UI must surface this, or
   a new player who picks "cool Pokémon" gets destroyed for reasons the game never explained.

#### B.3.3 Efficiency

Eval must be cheap: at 3 M nodes/s the whole eval has a ~300 ns budget.

- **Incremental material.** Keep a running `materialScore` updated in `makeMove`/`unmakeMove`.
  Zero cost at leaves.
- **Precompute `eff[18][18]` as an `Int8Array(324)`** with values {0,1,2,4} (quarter-multiplier ×4)
  so all effectiveness lookups are one indexed byte read. Also precompute
  `immuneMask[18]` as an 18-bit bitmask so "can any enemy type take me" is one AND.
- **`armyFit` is not recomputed per node.** It depends only on the *multiset of enemy types present*,
  which changes at most once per capture. Cache it on the position and invalidate on capture.
- **Two-tier eval.** A cheap `evalFast` (material + PST + incremental) at most leaves; the full
  relational eval only at nodes within 1 ply of the horizon or in the PV. Standard lazy-eval with a
  margin: if `evalFast ± 200` is already outside `[α, β]`, return it.

---

### B.4 Engineering

#### B.4.1 Web Worker — yes, and it is not optional

The AI runs in a dedicated Worker
([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers)).
Rationale: at Normal difficulty the search is a **700 ms uninterruptible loop**. On the main thread
that is 42 dropped frames, a frozen board, and an INP of 700 ms. In a Worker the board keeps
animating the opponent's "thinking" indicator at 60 fps and the human can still hover squares and
read the type panel.

Protocol — deliberately tiny, and mirrors the pure-engine constraint:

```ts
// main -> worker
{ type: 'search', position: SerializedPosition, seed: number,
  difficulty: Difficulty, softMs: number, hardMs: number, id: number }
{ type: 'abort', id: number }
// worker -> main
{ type: 'progress', id, depth, nodes, bestMove, scoreCp }   // once per completed depth
{ type: 'result',   id, bestMove, scoreCp, depth, nodes, ms }
```

The Worker imports the **same** `src/engine` module the UI does — that is the payoff of the Brief's
pure-engine rule. No duplicated rules, and the Worker is trivially testable in Node because it has no
DOM dependency. `SerializedPosition` is a compact struct (board `Int8Array(128)`, types
`Int8Array(128)`, flags) transferred as an `ArrayBuffer` — zero-copy, no `structuredClone` of objects.
Emit `progress` per depth so the UI can show a real "thinking, depth 6" indicator, which makes the
wait feel intentional.

#### B.4.2 WASM — no

Measured: plain JS reaches **3.0–3.3 M nodes/s** in this search on this machine, and **8.5 M
legal-nodes/s** for pure move generation. Typed arrays (`Int8Array` board, `Int32Array` move buffers)
and monomorphic call sites get JS within roughly 2–3× of C for this workload. Against that:

- Rust/AssemblyScript → `.wasm` adds a second toolchain to a Vite+TS project, a second language for
  the *rules* (or a rules re-implementation, which is the exact bug factory the Brief's pure-engine
  rule exists to prevent).
- WASM threads need `SharedArrayBuffer`, which needs COOP/COEP response headers, which breaks
  deploying to plain static hosting (GitHub Pages etc.).
- The strength target (§B.5) is met by depth 6–7 in ≤1.2 s, which JS already does.

Revisit only if a measured requirement appears for depth 9+.

#### B.4.3 Transposition table and Zobrist keys

The Zobrist key ([CPW](https://www.chessprogramming.org/Zobrist_Hashing)) must cover **everything the
evaluation and legality depend on**, or the TT will return values from a position that plays
differently. Ours needs more than chess:

```
key ^= Z.piece[class][color][square]          // 6 × 2 × 64
key ^= Z.type[typeId][square]                 // 18 × 64      <-- REQUIRED: type changes legality
key ^= Z.sideToMove                           // 1
key ^= Z.castling[rights]                     // 16
key ^= Z.epFile[file]                         // 8
key ^= Z.chainDepth[0..2]                     // 3            <-- extra-move state is part of the position
key ^= Z.status[statusId][square]              // v2: 5 non-volatile
key ^= Z.volatile[volId][square]               // v2: 37 volatile  (pack as a per-square bitset)
key ^= Z.item[itemId][square]                  // v2: only for items with board effects (~40, curated)
key ^= Z.hazard[hazardId][square]              // v2
```

Two subtleties that will cause real bugs if missed:

1. **`chainDepth` must be in the key.** The same board with "you have 1 extra move left" is a
   different position from the same board with "your turn is over". Omit it and the TT will happily
   hand a same-side-to-move value to an opponent-to-move node.
2. **HP, if HP exists, must be in the key** — but 32 pieces × N HP values explodes the key space and
   destroys hit rate. If the rules design lands on HP, bucket it (e.g. 4 buckets: full / hurt /
   critical / 1) and hash the bucket. Say so explicitly in the rules design; the AI cannot absorb
   fine-grained HP for free.

Because the interior search is deterministic (we collapsed the chance nodes), the TT is **sound** —
this is a second, non-obvious payoff of the collapse decision. With sampled chance nodes (mode H)
the TT would be poisoned by stale samples.

Table: 2^22 entries × 16 B = **64 MB**… too much for the memory budget (§A.4). Use 2^20 × 16 B =
**16 MB**, single-probe, replace-if-depth≥stored, `{key32, move16, score16, depth8, flags8}` packed
into two `Int32Array`s (no objects, no GC).

#### B.4.4 Iterative deepening and time management

```
soft budget = 0.55 × difficultyMs      // don't START a new depth past this
hard budget = 1.30 × difficultyMs      // ABORT mid-depth; keep previous depth's best move
```

- Check the clock every 4096 nodes (a counter compare, not a `Date.now()` per node).
- On hard abort, discard the partial depth and return the last **completed** depth's move. Never
  return a partially-searched depth's best move — that is how engines play blunders under time
  pressure.
- Aspiration windows: `[prev − 40, prev + 40]`, widen ×4 on fail.
- **Move ordering** (this is where the strength actually comes from): TT move → captures with
  `EΔ > 0` by descending `EΔ` → captures that grant extra moves (sharpest tactic in the game) →
  killers → history → quiet moves by PST delta. Note the ordering key is *expected* material, not
  SEE — same reasoning as §B.2.5.

#### B.4.5 Incremental move generation

Do not fully re-generate at every node. Two-stage:

1. **Staged generation**: yield the TT move first and return immediately if it causes a cutoff
   (measured in chess engines to avoid generating anything at ~60 % of nodes). Then captures, then
   quiets.
2. **Type-legality filter is free**: `eff[t_att*18 + t_def] === 0 → skip`. One byte read. It *reduces*
   the branching factor by ~2.5 % of captures — a tiny bonus, and the only place where our variant
   makes search easier than chess.
3. Reuse a per-depth preallocated `Int32Array(256)` move buffer (my prototype does this; it is why the
   probe hits 3 M nps in plain JS with zero allocation in the hot loop).

---

### B.5 Difficulty levels, strength targets and latency

#### B.5.1 The type-misjudgement dial — measured

The thematically right way to build a beginner AI for *this* game is not to make it search less. It is
to make it **wrong about types**, because that is exactly the mistake a new Pokémon player makes and
exactly the edge a knowledgeable player is supposed to have.

Implementation: the AI gets its own `eff` table, in which each of the 324 entries is, with probability
`typeErrorRate`, replaced by a uniformly random value from {0, ½, 1, 2}. It plays *correct chess* with
a *wrong type model*. Illegal-capture attempts are resolved by the true engine, so a confused AI will
occasionally try a capture that turns out to be no-effect — which is charming, legible, and exactly
what a beginner does.

Measured, 30 games per row, both agents identical otherwise (mode J, 40 k nodes/move, colours
alternated) — `probe_rendersearch_typeerr.mjs`:

| `typeErrorRate` | weak agent's score | record |
|---|---|---|
| 5 % | **47 %** | 10 W – 12 L – 8 D |
| 15 % | **45 %** | 10 W – 13 L – 7 D |
| 30 % | **37 %** | 8 W – 16 L – 6 D |
| 50 % | **30 %** | 7 W – 19 L – 4 D |
| 100 % (type-blind) | **25 %** | 5 W – 20 L – 5 D |

This is a **clean, monotonic dial** that never bottoms out — even a completely type-blind AI still
wins 25 % because it plays real chess. That is the ideal beginner opponent: beatable through Pokémon
knowledge, not frustrating, and it *teaches* — when it walks a Ground rook into your Flying bishop,
the player learns the immunity by watching the AI get it wrong.

#### B.5.2 The five difficulties

Each level composes three orthogonal knobs: **time budget**, **type-belief error**, and **blunder
injection** (with probability `p`, play a random move from the top-`k` instead of the best).

| Level | Time budget (hard) | Depth reached (est.) | `typeErrorRate` | Blunder | Est. chess strength | Feel |
|---|---|---|---|---|---|---|
| **Rookie** | 150 ms | 3–4 | **100 %** | 12 % from top-5 | ~800 Elo | Plays chess, ignores types entirely. Loses trades to type knowledge constantly. |
| **Trainer** | 300 ms | 4–5 | **50 %** | 6 % from top-3 | ~1200 | Knows some matchups, confidently wrong about others. |
| **Gym Leader** | 700 ms | 5–6 | **15 %** | 2 % from top-3 | ~1500 | Mostly right on types; punishes real mistakes. **Default.** |
| **Elite Four** | 1500 ms | 6–7 | **0 %** | 0 | ~1750 | Perfect type knowledge, full eval, exact root chance nodes. |
| **Champion** | 3000 ms + full quiescence + 2^21 TT | 7–9 | **0 %** | 0 | ~1900 | For the player who has beaten Elite Four. Explicit "may take up to 3 s" label. |

Latency contract per level: `p50 = 0.55 × budget`, `p95 ≤ 1.3 × budget` (the hard abort guarantees the
p95). The Elite Four row is the one to hold in CI: **p95 ≤ 1200 ms measured over 200 stored
positions**.

Elo numbers are *estimates* anchored on the measured node counts (Gym Leader ≈ 700 ms × 3 M nps ≈
2 M nodes ≈ depth 6 with our ordering) plus the well-known ~50–70 Elo/ply relationship for
material+PST evals at this depth. **They are labelled estimates because I have not calibrated against
humans.** Calibrate before shipping the labels: run each level against a flat-Monte-Carlo baseline and
against each other in a 200-game round robin, and publish the actual score matrix.

Anti-frustration rules, which matter as much as the numbers:
- The AI's *displayed* reasoning is honest at all levels: if Rookie thinks Ground beats Flying, the
  hint panel must not secretly show the right answer. Its wrongness is content.
- Never let a difficulty be weaker by *thinking slower*. Rookie at 150 ms feels snappy and dumb, which
  is right; a slow dumb AI is the worst combination.
- A **"Chaotic" personality toggle** (orthogonal to difficulty) switches interior chance nodes to
  single-sample (mode H): the AI genuinely gambles, playing coin-flip captures a solid engine avoids.
  It is measurably cheapest (75 k vs 43 k nodes… comparable) and produces the most memorable games.
  Ship it as a labelled personality, never as the default, and document that it makes the AI
  non-deterministic.

---

### B.6 Effort estimate (agent-days)

"Agent-day" = one focused day of an AI coding agent with review. Rendering and AI only; rules,
data-generation, draft and UI-content are other recons' scope.

| Work item | Days | Notes |
|---|---|---|
| **Rendering** | | |
| Board + pieces + squares math + CSS + a11y tree | 1.5 | includes keyboard navigation, `aria-label` per square |
| `MoveAnimator` (WAAPI) + durations table + 4 speed modes | 1.0 | |
| `FxQueue` (pure, deterministic) + particle ring buffer | 1.0 | |
| `Canvas2DRenderer` + 5 verdict effects + die reveal | 2.0 | this is where "satisfying" is won or lost; budget for iteration |
| `StaticRenderer` + reduced-motion path + tests | 0.5 | |
| Type Glyph mode (0-asset fallback) | 1.0 | pure CSS/SVG, contrast-checked |
| `vendor-sprites.ts` + manifest + baked `spriteUrl`/`iconOffsets` | 0.5 | probe already proved the download path |
| Perf harness in CI (size-limit, Playwright frame/memory gates) | 1.5 | 12 gates from §A.4 |
| **Rendering subtotal** | **10.0** | |
| **AI** | | |
| 0x88 position + movegen + perft + `chess.js` differential tests | 2.0 | prototype exists and passes perft(5); productionising with types/status is the work |
| Collapsed-interior / exact-root alpha-beta + iterative deepening + time mgmt | 2.0 | prototype exists |
| Quiescence with expected-material pruning | 1.0 | the variant-specific part |
| TT + Zobrist (incl. type/chain/status) + hit-rate instrumentation | 1.5 | |
| Move ordering (TT, EΔ captures, extra-move-first, killers, history) | 1.0 | biggest strength-per-day item |
| Evaluation: material + PST + mobility + king safety | 1.5 | |
| Evaluation: the four relational type terms + `armyFit` caching | 2.0 | the soul; needs tuning iterations |
| Worker plumbing + protocol + abort + progress | 1.0 | |
| Difficulty system (type-error, blunder, personalities) | 0.5 | measured, mechanically simple |
| Strength calibration: 200-game round robin + score matrix + Elo labels | 1.5 | mostly compute; needs a harness |
| Search regression bench in CI (nodes + p95 latency gates) | 1.0 | |
| **AI subtotal** | **15.0** | |
| **Total** | **25 agent-days** | plus ~15 % contingency for eval tuning ⇒ **~29** |

**Ship order.** v1 = board + pieces + normal/fast speed modes + gen5 stills + Gym Leader AI only
(collapsed search, material + PST + `superEffectiveVulnerability`, 700 ms) ≈ 13 days. v1.1 = full FX
suite, reduced motion, all 5 difficulties, Type Glyph mode ≈ 8 days. v2 = HD/animated sprites,
status/hazard eval terms, Champion difficulty, calibration ≈ 8 days. Everything in v1 is on the
critical path; nothing in v1.1+ is.

---

## Risks and open questions

1. **Mobile is unmeasured.** Every frame number here is Apple Silicon. The 3–5× derating is an
   assumption. **Action:** before v1 ships, run the `perf.html` and `tti.html` probes on a real
   mid-range Android and a 4× CPU-throttled Lighthouse run, and update §A.4.
2. **The strength numbers are estimates.** §B.5's Elo column is anchored on node counts, not on human
   games. It could be off by 200 Elo either way. The *relative* ordering is measured; the absolute
   labels are not.
3. **The type-multiplier spread is small (±15 %).** If the rules design wants type knowledge to be
   decisive, the *rules* must amplify it (e.g. crit only on ≥1× matchups, or a re-roll on 2×), because
   the raw chart plus a d6 gives the die two-thirds of the vote. This is the most important thing my
   measurements say to the rules designer.
4. **Steel/Grass/Bug imbalance is real and quantified** (P(survive) .583 vs .204; P(mutual) .426 for
   Grass and Bug). The draft design must either constrain or surface it.
5. **HP would hurt the AI.** If pieces get HP, the Zobrist key and the TT hit rate degrade and the
   eval gets a new continuous dimension. Bucket it (§B.4.3) and budget +2 agent-days.
6. **Ability/item systems will re-open the search cost question.** Every ability that changes capture
   resolution adds branches to the chance node. The collapse architecture absorbs this gracefully
   (still one modal successor), which is another reason to prefer it — but the *eval* will need a term
   per ability class, and that scales with the curated set size the abilities recon defines.
7. **`prefers-reduced-data`** has poor support; I recommend defaulting Type Glyph mode on when it *is*
   present, and otherwise offering it prominently.

---

## Appendix A — Probe inventory

All probes are in `/tmp/pkmn-probe` (Node) or `/tmp/corstest` (browser, served on `:8899`). Every
table in this document traces to one of these.

| Probe | What it measured | Headline result |
|---|---|---|
| `/tmp/corstest/index.html` | CORS behaviour of Showdown sprites in a real browser | no ACAO ⇒ WebGL `texImage2D` throws, canvas tainted, `fetch` blocked |
| `/tmp/corstest/perf.html` | script ms/frame: 64 DOM pieces, 400 DOM particles, 400 & 2000 canvas particles | 0.092 / 0.449 / 0.235 / 0.417 ms mean |
| `/tmp/corstest/look.html` | visual quality of gen5@80px pixelated vs dex@80px smooth | gen5 pixelated looks best; screenshot inspected |
| `/tmp/corstest/atlas.html` | packed atlas of the 733 gen-9 sprites | 1840 KB PNG (worse than individual) |
| `/tmp/corstest/atlas1025.html` | packed atlas of all 1025, 3 scales, PNG/WebP | 2563 KB PNG vs 849 KB individual ⇒ **don't atlas** |
| `/tmp/corstest/tti.html` | fetch+paint 32 sprites on a DOM board | 105 ms, FCP 76 ms, 32.7 KB |
| `probe_rendersearch_img.mjs` | `@pkmn/img` output shape | it is a CSS `background-position` API; icon sheet 40×30, 12 cols |
| `probe_rendersearch_sizes.mjs` | byte census of 6 sprite sources + CORS headers | table in §A.2.1 |
| `probe_rendersearch_dl1025.mjs` | downloaded all 1025 gen5 sprites | **829 KB total, 1025/1025 present** |
| `probe_rendersearch_gaps.mjs` | gen-9 view vs National Dex | gen 9 is missing **292** dex numbers incl. Alakazam, Machamp |
| `probe_render_bundle.mjs` | baked-data payload sizes, gzip + brotli | columnar species 12.0 KB gz; learnsets 70.5 KB gz |
| `/tmp/bundletest` (esbuild) | tree-shaken lib sizes | Pixi 165 KB gz, motion/mini 3 KB, React 58 KB |
| `probe_render_perft.mjs` | move-gen correctness + speed | perft(5)=4,865,351 ✓ at 8.5 M legal-nodes/s |
| `probe_render_ab.mjs` | plain chess vs variant with chance nodes, depths 1–7 | variant depth 7 = 7.6 M nodes vs 0.97 M plain |
| `probe_render_star2.mjs` | sound full-window vs star1 (±3000 bounds) | star1 **1.7× worse** (22.3 M vs 12.9 M) |
| `probe_render_modeE.mjs` | extra-move chain cap 0 / 1 / 2 | 8.38 M / 11.87 M / 12.86 M ⇒ cap 2 costs +53 % |
| `probe_rendersearch_search.mjs` | 6 chance-node strategies × 2 positions × depths 4–7 | table in §B.2.1; collapse ≈ plain-chess cost |
| `probe_rendersearch_agree.mjs` | root-move agreement of cheap vs sound search | G 42 %, J 46 %, root-hybrid 54 %; root-exact overhead +11 % |
| `probe_rendersearch_selfplay.mjs` | equal-node-budget match, sound vs collapsed | 120 games, collapsed 53.8 % ± 4.6 % ⇒ **no significant difference** |
| `probe_rendersearch_typeerr.mjs` | difficulty via corrupted type belief | 5 %→47 %, 15 %→45 %, 30 %→37 %, 50 %→30 %, 100 %→25 % |
| `probe_rendersearch_typevalue.mjs` | real Gen 9 type chart × variant capture semantics | per-type table + 8 illegal pairs + 33 % value spread |

## Appendix B — Citations

Rendering / web platform
- MDN, CORS-enabled image — https://developer.mozilla.org/en-US/docs/Web/HTML/CORS_enabled_image
- MDN, `crossorigin` attribute — https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/crossorigin
- MDN, `image-rendering` — https://developer.mozilla.org/en-US/docs/Web/CSS/image-rendering
- MDN, `prefers-reduced-motion` — https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion
- MDN, Web Animations API — https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API
- MDN, Using Web Workers — https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers
- MDN, OffscreenCanvas — https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas
- web.dev, Interaction to Next Paint — https://web.dev/articles/inp
- web.dev, Largest Contentful Paint — https://web.dev/articles/lcp
- Chrome, Time to Interactive — https://developer.chrome.com/docs/lighthouse/performance/interactive
- PixiJS v8 guides — https://pixijs.com/8.x/guides
- Motion (`animate`) — https://motion.dev/docs/animate

Assets / licensing
- Pokémon Showdown client (AGPLv3 code; `/sprites/` excluded from repo) — https://github.com/smogon/pokemon-showdown-client
- `pkmn/ps` (MIT data + `@pkmn/img`) — https://github.com/pkmn/ps
- PokéAPI sprites (no LICENSE file; verified 404) — https://github.com/PokeAPI/sprites
- PokéAPI docs, fair-use policy — https://pokeapi.co/docs/v2

Search
- Ballard, B. W., "The \*-minimax search procedure for trees containing chance nodes",
  *Artificial Intelligence* 21(3):327–350, 1983. doi:10.1016/0004-3702(83)90016-7
- Hauk, Buro & Schaeffer, "Rediscovering \*-Minimax Search", *Computers and Games* 2006, LNCS 3846 —
  https://link.springer.com/chapter/10.1007/11922155_3
- Wikipedia, Expectiminimax (chance-node bounds derivation) — https://en.wikipedia.org/wiki/Expectiminimax
- CPW, Monte-Carlo Tree Search — https://www.chessprogramming.org/Monte-Carlo_Tree_Search
- CPW, UCI — https://www.chessprogramming.org/UCI
- CPW, Zobrist Hashing — https://www.chessprogramming.org/Zobrist_Hashing
- CPW, Transposition Table — https://www.chessprogramming.org/Transposition_Table
- CPW, Quiescence Search — https://www.chessprogramming.org/Quiescence_Search
- CPW, Iterative Deepening — https://www.chessprogramming.org/Iterative_Deepening
- CPW, Late Move Reductions — https://www.chessprogramming.org/Late_Move_Reductions
- Stockfish — https://github.com/official-stockfish/Stockfish
- Fairy-Stockfish — https://github.com/fairy-stockfish/Fairy-Stockfish
- Fairy-Stockfish variant configuration (the option list; no chance/pairwise-capture support) —
  https://github.com/fairy-stockfish/Fairy-Stockfish/wiki/Variant-configuration
- stockfish.wasm (SharedArrayBuffer / COOP-COEP requirement) — https://github.com/lichess-org/stockfish.wasm
- chess.js (test oracle) — https://github.com/jhlywa/chess.js
