# Recon: Rendering, Performance & AI Search

**Role:** rendering / performance / AI-search analyst.
**Scope:** BRIEF.md hard problems 7 (rendering & performance) and 8 (AI opponent), plus DIRECTION.md's
"performance is part of looking good" and "animation must never gate play".
**Method:** every number below was measured on this machine, either in the real repo, in headless
Chrome 151 via Playwright (`/tmp/pcbench/bench.html`), or in Node v24.19.0 against a working variant
searcher (`/tmp/pkmn-probe/tech-recon-*.mjs`). Where I extrapolate — and I only do it for slower
hardware — I say so and give the multiplier.

Sprite asset sizes are **not** re-measured; they are taken from
[`recon-data-substrate.md`](./recon-data-substrate.md) §6 as instructed.

---

## 0. Executive decisions

| # | Decision | The number that decides it |
|---|---|---|
| A1 | **Hybrid: keep the DOM board and pieces, add two Canvas2D effect layers.** Not pure DOM, not pure Canvas, and definitely not WebGL/Pixi. | Canvas2D draws 10,000 particles in **0.84 ms/frame**; the equivalent DOM work at 4,000 elements costs **5.38 ms**. But a full DOM board is only **129 nodes** and a from-scratch rebuild of it costs **0.39 ms** — free. Use each where it wins. |
| A2 | **Extend the existing `src/ui/App.tsx` board, do not replace it.** | It already has 64 `<button>`s with real `aria-label`s and native focus. A canvas rewrite forfeits all of it and buys nothing measurable (see A1). Migration cost is ~2 days of refactor, mostly moving pieces out of the square buttons into one transform-positioned layer. |
| A3 | **Reject WebGL/PixiJS.** | `pixi.js@8` browser bundle measured at **231 KB gzipped** — 3.5× the entire current entry chunk (65 KB) — to buy headroom we measured we do not need. |
| A4 | **The entry-chunk budget conversation is about React, not about our code.** | React 19 + react-dom/client, bundled and minified by rolldown: **59.3 KB gz**. The entry chunk is 65.2 KB gz. **Our own code is 5.9 KB gz — 9% of the budget.** Preact core measures 4.4 KB gz, so `preact/compat` is a documented 52 KB reclaim lever if the budget is ever threatened. |
| B1 | **Alpha-beta negamax + PVS + quiescence, in a Web Worker. Not expectiminimax, not MCTS.** | Measured: depth 9 in **601 ms**, depth 10 in 2.5 s, at **7.1 M nodes/sec** in plain JS with an effective branching factor of **3.8–4.2**. |
| B2 | **Full chance-node enumeration for the d6 is not affordable, and star1 pruning does not rescue it.** | Depth 6 costs **1,946 ms** with chance nodes vs **16 ms** deterministic — a **159×** blow-up, ~4 plies of depth. Star1 with realistic ±4500 cp bounds recovers only **20%** (1,652 ms). |
| B3 | **Adopt input randomness (roll revealed at turn start), and it is the single biggest AI decision in the project.** | Measured cost over deterministic: **+10%** (20.6 ms vs 16.1 ms at depth 6; 604 ms vs 610 ms at depth 8). `recon-variants.md` §6.3 already recommends this for *balance* reasons. It independently makes the AI **~150× cheaper**. Two lenses, one answer. |
| B4 | **Sample the randomness at the root, never inside the tree.** | In-tree sampling multiplies: k=3 samples per ply costs **726×** (8,544 ms at depth 6) because cost ≈ k^depth. Root-level averaging over R sampled futures is linear in R. |
| B5 | **Reject WASM for v1.** | 7.1 Mnps in JS. A realistic 2× WASM win buys log₄(2) = **0.5 plies** at our EBF. Four cheaper changes each buy more. |
| B6 | **Difficulty is a corrupted type chart, not a shallower search.** | The AI searches with its own copy of the 18×18 effectiveness table. A beginner AI's copy has the 0.5×/2× entries flattened except the starter triangle — so it walks into mutual destruction and misses free bonus moves. Thematically exact, and *learnable* by the player. |

---

## PART A — Rendering architecture and performance

### 1. What was measured

Environment: Chrome 151 headless, macOS, Apple Silicon, 12 cores, `devicePixelRatio = 2`, 640×640
board, **120 Hz display** (vsync interval measured at 8.33 ms, not 16.67 — noted because it makes
every frame-time figure below a *tighter* test than 60 Hz).

Harness: `/tmp/pcbench/bench.html`, run via Playwright. Two passes — one measuring wall-clock frame
intervals over 150 frames, one measuring **per-frame CPU cost in isolation** (60 timed iterations
after a 10-iteration warm-up, no vsync involved) so the numbers can be scaled to slower hardware.

#### 1.1 Frame intervals over 150 frames (p50 / p95 / max, ms)

| Architecture | 0 fx | 200 fx | 600 fx | 1500 fx | 4000 fx |
|---|---|---|---|---|---|
| DOM board + per-frame `transform`/`opacity` writes from rAF | 8.3 / 9.2 / 12.5 | 8.3 / 9.3 / 16.9 | 8.3 / 9.0 / **42.1** | 8.3 / 8.9 / **91.7** | **16.7** / **33.3** / **333** |
| DOM board + CSS/WAAPI keyframes (compositor-driven) | 8.3 / 9.2 / 9.4 | 8.3 / 8.5 / 9.4 | 8.3 / 9.0 / 15.7 | 8.4 / **17.6** / **83.2** | **49.9** / **58.4** / **391** |
| Canvas2D, full redraw of board + 32 sprites + fx | 8.3 / 9.2 / 25.0 | 8.3 / 8.4 / 9.3 | 8.3 / 8.4 / 9.3 | 8.3 / 8.5 / 41.6 | **8.3 / 8.4 / 9.3** |
| **Hybrid: DOM board + Canvas2D fx layer** | 8.3 / 8.4 / 8.7 | 8.3 / 8.4 / 9.1 | 8.3 / 8.4 / 9.1 | 8.3 / 8.4 / 9.3 | **8.3 / 8.4 / 8.6** |

Two things fall out immediately.

- **Canvas2D and the hybrid stay pinned to vsync at 4,000 simultaneous effects.** DOM breaks between
  1,500 and 4,000.
- **WAAPI/CSS keyframes break *earlier* than rAF style writes** at 1,500 (p95 17.6 vs 8.9). This is
  counter-intuitive and worth knowing: each independently-timed composited animation gets its own
  compositor layer, and 1,500 layers cost more than 1,500 transform writes on one layer each frame.
  *Consequence: cap concurrent composited CSS animations at ~200 and push the rest to canvas.*

#### 1.2 Per-frame CPU cost, isolated (ms/frame — the hardware-scalable numbers)

| Work | 0 | 200 | 600 | 1500 | 4000 | 10000 |
|---|---|---|---|---|---|---|
| Canvas2D: `clearRect` + 64 squares + 32 sprite `drawImage` + 32 rings + N particles | **0.027** | 0.052 | **0.102** | 0.167 | **0.352** | **0.842** |
| DOM: write `transform`+`opacity` on N elements, then force style recalc + layout | 0.000 | 0.238 | **0.698** | 2.053 | **5.380** | — |
| DOM: rebuild the entire 64-square board from scratch (`createElement` ×129 + layout) | **0.392** | | | | | |

Per-unit cost: **canvas particle ≈ 0.08 µs**, **animated DOM element ≈ 1.35 µs**. Canvas is **17×
cheaper per moving thing**. But the DOM board costs **0.39 ms for a total teardown-and-rebuild**,
which is a rounding error — a targeted diff of the ≤8 squares that actually changed is
~0.05 ms.

#### 1.3 DOM node count and bundle facts, measured in the real repo

| Fact | Value |
|---|---|
| DOM nodes in a full 8×8 board with 32 pieces, rings and side markers | **129** |
| Entry chunk `dist/assets/index-*.js` | 206,003 raw / **65,154 gz** |
| React 19 + `react-dom/client`, bundled+minified alone | 190,850 raw / **59,285 gz** |
| ⇒ the app's own code in the entry chunk | **≈ 5,900 gz (9%)** |
| Preact 10 core, bundled+minified | 10,370 raw / **4,376 gz** |
| `pixi.js@8` `dist/pixi.min.mjs` | 819,517 raw / **231,272 gz** |
| `@lichess-org/chessground@10` `dist/chessground.min.js` | 32,686 raw / **12,089 gz** |
| Lazy data chunks (gz) | species 76.9 · moves 77.9 · learnsets 75.6 · abilities 21.6 · items 21.9 · typechart 0.33 = **274 KB** |
| CSS | 837 raw / **521 gz** |

### 2. The four architectures, compared and decided

#### DOM + CSS transforms
- **For.** It is what we already have and it is the only option that gets accessibility for free: 64
  focusable `<button>`s with `aria-label`s, native keyboard traversal, browser zoom, text selection,
  high-contrast mode, and a screen reader that can read the board square by square. The
  [WAI-ARIA `grid` pattern](https://www.w3.org/WAI/ARIA/apg/patterns/grid/) applies directly and gives
  us arrow-key navigation with no custom hit-testing. `transform` and `opacity` are the two
  compositor-only properties, so simple motion never touches layout
  ([MDN, animation performance](https://developer.mozilla.org/en-US/docs/Web/Performance/Animation_performance_and_frame_rate)).
  Zero bundle cost. Lichess's own board renderer, **Chessground**, is DOM-based —
  "uses a custom DOM diff algorithm to reduce DOM writes to the absolute minimum… 10K gzipped… SVG
  drawing of circles, arrows" (<https://github.com/lichess-org/chessground>). The largest chess site
  in the world made this call.
- **Against.** Measured ceiling ~1,000 concurrently animated elements before the frame breaks
  (§1.2: 600 → 0.70 ms, 1,500 → 2.05 ms, and the frame-interval table shows p95 failure at 1,500 with
  WAAPI). DIRECTION.md §"Visuals" asks for weather over the whole board, hazards on squares, status on
  pieces and a capture animation *simultaneously* — that is a particle budget, and particles are where
  DOM loses 17:1.
- **Licensing note.** Chessground is **GPL-3.0**. This repo is Apache-2.0. Read it as an architectural
  reference; do not vendor, copy or link it. That would relicense the project.

#### Canvas2D (everything)
- **For.** Cheapest per moving thing by a wide margin, and it held 8.3 ms at 4,000 particles *including
  redrawing the board and all 32 sprites every frame*.
- **Against.** It forfeits every accessibility affordance in one move: no focusable squares, no aria
  tree, no keyboard model, nothing for a screen reader, and hit-testing, focus rings, hover states and
  tooltips all become our code. The standard mitigation is a parallel invisible DOM tree mirroring the
  canvas — at which point you are maintaining both and paying the DOM cost anyway. DIRECTION.md ranks
  legibility as a hard constraint; a canvas board makes the most basic legibility affordance (reading
  the board) a bespoke engineering project. **Rejected as the primary surface.**

#### WebGL via PixiJS
- **For.** Effectively unlimited sprite/particle throughput, real shaders (type-coloured additive
  glows, distortion on a super-effective hit, weather as a full-board shader).
- **Against, decisively.** **231 KB gz measured** — it would make our entry chunk 4.5× larger to solve
  a problem the measurements say we do not have (Canvas2D: 10,000 particles at 0.84 ms). It brings a
  WebGL context-loss recovery path, a texture-atlas pipeline, and a second rendering mental model.
  Everything canvas gives up on accessibility, WebGL gives up too, plus more. **Rejected.** Revisit
  only if a design lands that genuinely needs per-pixel shading over the whole board at 60 fps — and
  even then, prefer a single fragment shader in a bare `WebGL2RenderingContext` (~4 KB of our own
  code) over a framework.

#### Hybrid: DOM board and pieces + Canvas2D effect layers ← **RECOMMENDED**
- Measured cost at 4,000 particles: **8.3 / 8.4 / 8.6 ms** — identical to pure Canvas2D, i.e. the DOM
  board contributes nothing detectable.
- Keeps every accessibility affordance, keeps the 5.9 KB app bundle, and lifts the effect ceiling from
  ~1,000 elements to >10,000.
- This is also, in substance, the Chessground architecture (DOM pieces, separate SVG/overlay layer for
  drawn shapes) with the overlay upgraded from SVG to Canvas2D because our overlay is particle-heavy
  rather than vector-heavy.

**Decision: hybrid.** Two canvases, not one: `fx-under` (below the pieces, for hazards, terrain,
ground-level shockwaves, square auras) and `fx-over` (above, for explosions, beams, debris, weather).
An empty canvas costs 0.027 ms/frame to clear and draw, so the second one is free.

### 3. Frame-budget arithmetic

Target: **60 fps on a mid laptop and on mobile**, i.e. a 16.67 ms frame. Following
[web.dev RAIL](https://web.dev/articles/rail), reserve ~6 ms for the browser's own style/paint/
composite/GPU work and give our JS **10 ms**.

All measurements above are on Apple Silicon. Extrapolation factor for the target device class — and
this is an estimate, not a measurement: **6×** for a mid-range Android or a 2019 Intel laptop
(JS ~4×, canvas fill-rate ~6× at similar backing-store area). I use 6× everywhere to be
conservative.

Budget at 60 Hz on a 6×-slower device, worst frame during a big capture:

| Line item | Measured here | ×6 | Share of the 10 ms |
|---|---|---|---|
| DOM: diff and write the ≤8 squares that changed + ≤32 piece transforms | ~0.05 ms | 0.30 ms | 3% |
| DOM: piece adornments (type ring, status chip, item glyph, vigour pips) — ≤160 composited elements, CSS-animated, zero per-frame JS | 0 ms | 0 ms | 0% |
| Canvas `fx-under`: hazard glyphs, terrain wash, square auras (~64 draws) | 0.03 ms | 0.18 ms | 2% |
| Canvas `fx-over`: **design ceiling 1,200 simultaneous particles** + 20 beams | ~0.14 ms | 0.84 ms | 8% |
| Presenter tick: advance the timeline, update ~1,200 particle states | ~0.05 ms | 0.30 ms | 3% |
| **Total** | **~0.27 ms** | **1.62 ms** | **16%** |

**Headroom: 6.2×.** That is the whole argument for rejecting WebGL. Even at 120 Hz (8.33 ms frame,
~4 ms of JS budget) on a 6×-slower device the worst frame uses 40% of the budget.

The two numbers to hold as hard ceilings, because they are where the measurements bend:

- **≤ 1,200 simultaneous canvas particles.** 4,000 measured at 0.352 ms → 2.1 ms at 6×, which is 21%
  of the budget for one effect. 1,200 keeps any single effect under 10%.
- **≤ 250 persistent DOM nodes inside the board, and ≤ 200 concurrent composited CSS animations.**
  We are at 129 nodes today; adornments and square-state glyphs take it to ~250. The 1,500-element
  WAAPI failure (p95 17.6 ms) is the empirical wall.

Explicitly **out of budget**: React reconciliation during an animation. React must not appear in the
per-frame path at all (see §6.4).

### 4. The existing DOM board: keep, extend, replace?

**Verdict: extend.** `src/ui/App.tsx` is a working slice — it drafts from the real dex, lays pieces on
real starting squares, and resolves outcomes through the real type chart. Its board is 129 DOM nodes
with correct `aria-label`s (`"e4: white knight, Lucario, Fighting type"`) and native button focus. That
accessibility work is done and a canvas rewrite throws it away for no measured gain.

Four changes are needed, and they are the whole migration:

1. **Move pieces out of the square buttons into one transform-positioned layer.** Today the sprite is
   a child of the `<button>` for its square, so a move means unmounting one subtree and mounting
   another — no animation is possible and React churns two subtrees. Change to Chessground's model: a
   single `<div class="pieces">` spanning the board, one absolutely-positioned piece element per piece
   keyed by a **stable piece id** (not by square), positioned with
   `transform: translate(var(--x), var(--y))`. Moving a piece is then one custom-property write, the
   browser animates it on the compositor, and captures/deaths become an exit animation on a element
   that still exists. *Cost: ~1 day. This is the load-bearing refactor.*
   - Accessibility is preserved by keeping the square `<button>`s as the interactive/AT layer with the
     occupant named in their `aria-label` (as now), and marking the piece elements `aria-hidden`.
2. **Extract inline styles into CSS with custom properties.** Every style in `App.tsx` is an inline
   object literal, which means a new object identity per render and no way for CSS to animate anything.
   Move to classes + `--type-color`, `--x`, `--y`, `--vigour`. *Cost: ~0.5 day. Also deletes most of
   the render function's allocation.*
3. **Add the layer stack and the two canvases.** *Cost: ~0.5 day for the scaffolding.*
4. **Insert the Presenter between engine state and the board.** *Cost: ~2 days including the timeline.
   This is new work rather than migration.*

**Total migration cost: ~2 days**, plus ~2 days for the Presenter that would be needed under any
architecture. A canvas or Pixi rewrite is ~2 weeks and starts by re-implementing focus, hit-testing
and an aria mirror.

What to keep verbatim: `src/engine/board.ts` (the precomputed `RAYS`/`BETWEEN`/`KNIGHT_MOVES` tables
are exactly what the AI needs — see Part B), `src/engine/typechart.ts` (synchronous, statically
imported, correct), `src/engine/rng.ts` (xoshiro128** with 4-word serialisable state — this is what
makes root-level Monte Carlo sampling reproducible), `src/ui/typeColors.ts` (the palette spine
DIRECTION.md fixes), and `src/data/dex.ts`'s lazy chunking.

### 5. Performance budgets to hold the implementation to

Every row is a CI gate, not an aspiration. "Measured today" is from this machine.

| Budget | Target | Measured today | Enforcement |
|---|---|---|---|
| **Entry chunk (JS, gz)** | **≤ 110 KB** | 65.2 KB | `vite build` + a `size-limit`-style script that fails the build. Note 59.3 KB of that is React; our code has room to grow 8× before the gate trips. Reclaim lever if breached: `preact/compat` (−52 KB measured). |
| **CSS (gz)** | ≤ 12 KB | 0.5 KB | same gate |
| **Data on the critical path to a playable board (gz)** | **≤ 60 KB** | *would be 274 KB if loaded whole* | Split the bundles: see §5.1. |
| **Total transfer to first interactive frame** | ≤ 200 KB gz + the 383 KB sprite sheet in parallel | — | Lighthouse in CI |
| **Time to interactive (draft screen usable), cold cache, simulated Fast 3G / 4× CPU throttle** | **≤ 2.5 s** | not yet measurable (no draft screen) | Lighthouse CI budget |
| **Time to interactive, warm cache** | ≤ 400 ms | — | same |
| **Frame time, p95, during any effect, 60 Hz mid device** | **≤ 10 ms** | 8.4 ms p95 at 4,000 particles on this machine (≈ 1.6 ms of JS at 6× scaling) | a dev-mode frame-time HUD + a Playwright perf test that replays a scripted "worst frame" (super-effective capture + mutual destruction + weather + 6 hazard squares) and asserts p95 |
| **Frame time, max (no dropped-frame spikes >2 frames)** | ≤ 33 ms | 8.6 ms hybrid @4,000 | same |
| **Simultaneous canvas particles** | ≤ 1,200 | — | a hard cap in the particle pool allocator; over-budget emitters degrade (fewer particles, same silhouette) rather than drop frames |
| **Persistent DOM nodes inside the board** | ≤ 250 | 129 | a test that counts `board.querySelectorAll('*').length` |
| **Concurrent composited CSS animations** | ≤ 200 | — | asserted by the same test |
| **JS heap after 100 moves with effects** | ≤ 60 MB, and **no monotonic growth** over a 200-move replay | — | a Playwright test taking two `performance.measureUserAgentSpecificMemory()` samples 100 moves apart; particle pools are pre-allocated typed arrays, so growth means a leak |
| **Engine: legal sub-move generation for one position** | **≤ 5 µs** | **0.194 µs** measured (`genMoves`, one side, full board) | a Vitest benchmark with a threshold |
| **Engine: `apply(state, action)` including all effect hooks** | ≤ 20 µs | — | same |
| **AI think time, hard cap** | **≤ 3 s** at the top difficulty, ≤ 1 s at mid, with a **350 ms floor** so it never feels twitchy | depth 9 in 601 ms; depth 10 in 2.5 s | the worker checks the clock every 4096 nodes (≈0.6 ms granularity at 7 Mnps) and always returns the best move from the last completed iteration |
| **AI: main-thread block during a search** | **0 ms** | — | the search only ever runs in a Web Worker; a lint rule forbids importing `search.ts` from anything under `src/ui/` |

#### 5.1 How the 60 KB critical-path data budget is met (measured)

The generated bundles today total 274 KB gz, and `species.json` alone is 76.9 KB gz. A draft screen
does not need `baseStats`, `evoCondition`, `learnsetRef`, `tier` or `tags` for 1,367 formes — it needs
number, name, types, BST, sprite offset and ability slots. I built that projection from the real
`species.json` and measured it:

| Projection of the real `species.json` | Raw | **gz** |
|---|---|---|
| As shipped, all 1367 formes, all 29 keys | 508,302 | **76,889** |
| Tuple-per-entry `[num,name,types,bst,icon,abilities,formeKind]`, all 1367 formes | 115,887 | **26,110** |
| Same, 1025 base formes only | 78,775 | **20,529** |
| **Columnar (parallel arrays, `\|`-joined strings), 1025 base formes** | 60,651 | **17,449** |

**4.4× smaller.** So the split is:

| Chunk | Contents | gz | When |
|---|---|---|---|
| `dex-index` | columnar 1025-base draft index | **17.4 KB** | eager, on the critical path |
| `move-effects` | the ~24 B packed derived `MoveEffect` record × 867 moves (`recon-moves.md` §6.5) | ~21 KB | eager |
| `ability-item-effects` | 310 archetype records + 311/583 `shortDesc` strings (`recon-abilities-items.md` §7) | ~19 KB | eager |
| `typechart` | as today | 0.33 KB | statically imported (already correct) |
| **Critical path total** | | **≈ 58 KB** | ✅ under budget |
| `species-detail` | the current full `species.json` | 76.9 KB | on idle (`requestIdleCallback`) or on first inspect |
| `moves-full`, `items-full`, `abilities-full` | prose, full descs | 121 KB | on first inspect |
| `learnsets` | 841-id union table | 75.6 KB | only behind the "Custom moveset" advanced toggle (`recon-moves.md` §6.4) |

`src/data/dex.ts`'s `once()`-wrapped dynamic imports already implement exactly this pattern; it needs
the extra, thinner chunk, not a new mechanism.

#### 5.2 Sprites, and a conflict I have to flag

Per `recon-data-substrate.md` §6, tiering is settled: one 383 KB icon sheet for board pieces, gen5
stills (~970 B each, 32 species ≈ 31 KB) for draft cards and capture close-ups, animated GIFs
(~85 KB each) opt-in only, official artwork for a single detail view. `PokemonIcon.tsx` already does
the sheet correctly and `index.html` already has the `preconnect`.

**The conflict:** BRIEF.md §4.6 requires *"Single-player vs AI must work offline"*, but the sprite plan
**hotlinks `play.pokemonshowdown.com`**. A cold-start offline game currently renders 32 blank squares.

**Resolution (recommended):**
1. A service worker that, on first successful load, puts `pokemonicons-sheet.png`,
   `itemicons-sheet.png` and the 18 type badges (~3 KB total) into the
   [Cache API](https://developer.mozilla.org/en-US/docs/Web/API/Cache). This gives offline play after
   one online session **without redistributing Nintendo/Creatures/GAME FREAK assets in the repo**,
   which is the licensing constraint `recon-data-substrate.md` §6 raises.
2. A **first-class text fallback**, not an error state: on sprite load failure, render a
   type-coloured disc with the species' 3-letter abbreviation and the piece-class glyph. The game must
   be fully playable in that state. This is cheap and it also covers the case where Showdown's CDN
   changes paths.
3. Add `decoding="async"` / `loading="eager"` semantics via a single hidden `<img>` preloader for the
   sheet so the first paint of the board is not a flash of empty squares.

The 32 gen5 stills (31 KB total) should be fetched during the *draft*, when the species are decided
and the player is reading anyway — by the time the match starts they are warm.

### 6. Effect layering, compositing, and the animation orchestration model

DIRECTION.md commits us to four distinct, text-free capture animations, a dramatised bonus move,
visible hazards/status/weather/trapping, a speed control and a skip, `prefers-reduced-motion`, and
"animation must never gate play". That is an orchestration problem, not a rendering problem.

#### 6.1 The six-layer stack — z-order by construction, not by luck

Every z-index in the app is one of exactly six custom properties, declared once:

```css
:root {
  --z-board:        0;   /* 64 <button> squares: base colour, coordinates, focus ring, aria       */
  --z-square-state: 1;   /* DOM, inside each button: hazard glyph, terrain tint, legal-move dot,  */
                         /*   last-move highlight, threat marker. <= 4 per square, never recreated */
  --z-fx-under:     2;   /* Canvas2D: ground effects, shockwave rings, square auras, weather floor */
  --z-pieces:       3;   /* DOM, one transform-positioned element per piece, keyed by piece id     */
  --z-piece-adorn:  4;   /* DOM, children of the piece: type ring, status chip, item glyph,        */
                         /*   vigour pips, ward shield. CSS-animated, no per-frame JS              */
  --z-fx-over:      5;   /* Canvas2D: explosions, beams, debris, sparks, weather ceiling           */
  --z-hud:          6;   /* React DOM, outside the board's stacking context                        */
}
```

Rules that make z-order bugs structurally impossible:

- **No literal `z-index` anywhere else.** A lint rule enforces it.
- The board is a single `position: relative` stacking context with `isolation: isolate`, so nothing
  inside it can escape and nothing outside can interleave.
- Both canvases are `position: absolute; inset: 0; pointer-events: none; aria-hidden: true` — they can
  never steal a click or confuse a screen reader.
- Effects choose `under` or `over` **from data**, not from code position: each effect archetype carries
  a `layer: 'under' | 'over'` field. Hazards, terrain and Sticky Web are `under` (a piece stands *on*
  them); explosions, type-flashes and weather particles are `over`.

#### 6.2 Tearing: one ticker, one write phase

Tearing and layout thrash both come from interleaving reads and writes, or from two animation systems
driving the same property. Both are prevented by policy:

- **Exactly one `requestAnimationFrame` loop in the whole application** (a `Ticker` singleton).
  Nothing else calls rAF. Every frame runs four phases in a fixed order:
  `read` (any needed geometry, once) → `simulate` (advance the timeline and particle pools) →
  `write` (all DOM custom-property writes, batched) → `draw` (clear + paint both canvases).
  Reads never follow writes, so there is no forced synchronous layout.
- **A property is owned by exactly one system.** A piece's `transform` is owned by CSS (via a custom
  property the ticker writes); a particle's position is owned by canvas. Never a CSS transition *and*
  a rAF write on the same property of the same element — that is the classic source of visible
  stutter.
- **Both canvases are drawn in the same `draw` phase**, so they can never present a frame apart.
- `will-change: transform` only on the ≤32 piece elements and only while a move is in flight (it is
  removed on completion; a permanent `will-change` on 250 elements is how you get the 1,500-layer
  regression from §1.1).
- **The [View Transition API](https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API) is
  explicitly rejected** for board animation: it snapshots the whole document and serialises
  transitions, which is precisely the "animation gates play" failure DIRECTION.md forbids. It is
  appropriate for screen-level transitions (draft → match) only.

#### 6.3 Decoupling: the engine never waits, and never knows the UI exists

```
engine (pure, no DOM)                  presenter (owns time)              renderer
─────────────────────                  ────────────────────               ────────
apply(state, action, roll)
  → { state', events: EffectEvent[] }  ──▶  ingest(events)                  ──▶ DOM writes
                                             build Cue[] on a beat grid     ──▶ canvas draws
authoritative state advances                 interpolate displayed state
INSTANTLY. Nothing awaits.                   accept input at any time
```

- `EffectEvent` is **pure serialisable data** in the replay log:
  `{ seq: number, kind: EffectKind, actors: Square[], payload: {...} }`. The engine emits it as a
  by-product of resolution. It contains no timing, no colours, no DOM references. Because it is in the
  log, a replay reproduces the *animation* as well as the game — and a network client can render a
  move it did not compute.
- The presenter holds two states: `authoritative` (the engine's, always current) and `displayed`
  (derived, lagging). Every visual is a pure function of `displayed`. This is what makes skipping
  safe: `settle()` sets `displayed = authoritative` and jumps every in-flight cue to its end pose.
- **Input is never gated.** `onSquareClick` calls `presenter.settle()` first and then dispatches. If
  you click during an explosion, the explosion completes instantly and your move is accepted. Nothing
  anywhere `await`s an animation.
- The AI's reply is computed in the worker *while* the animation plays, so animation time is free
  latency. At mid difficulty (≤1 s think time) and a ~900 ms capture animation, the AI's move is
  usually ready before the player has finished watching theirs.

#### 6.4 The beat grid: deterministic ordering for simultaneous effects

Free-form animation scheduling is where "many simultaneous effects" becomes an ordering bug. Instead,
every action's cues are laid out on a fixed **beat grid**, so two effects can never race:

| Beat | Nominal ms (at 1× speed) | What plays | DIRECTION.md requirement it serves |
|---|---|---|---|
| 0 `MOVE` | 180 | the piece travels (compositor transform, eased) | baseline readability |
| 1 `CLASH` | 220 | type-vs-type flash on the defender's square: the multiplier reads from the *shape* of the flash, not text — 2× = expanding double ring in the attacker's type colour; 1× = single soft pulse; 0.5× = two clashing rings that shatter inward; 0× = a hard grey rejection stamp with a recoil bounce on the attacker | "the four outcomes must be instantly distinguishable without reading text" |
| 2 `DEATH` | 240 | defeated pieces dissolve into type-coloured particles. **Mutual destruction plays two dissolves simultaneously, mirrored** — it must be visibly *both* | "mutual destruction should visibly destroy both pieces" |
| 3 `AFTERMATH` | 200 | ward pop (a shield cracking), thorns recoil, status applied, item consumed, hazard triggered, drain, Vigour pip change | "hazards visibly sitting on squares, status visibly afflicting a piece" |
| 4 `GRANT` | 320 | **the bonus move.** Board dims by 25%, the granted piece gets a persistent pulsing aura in its type colour, a chevron banner slides in, and the legal targets for the extra move light up. The aura persists until the sub-move is played — a player cannot miss that they have it | "the free extra move must be dramatised… a player must never miss that they have it" |
| 5 `AMBIENT` | ∞ | weather particles, terrain wash, idle sprite bob, trapped-piece chains, aura rings | "weather and terrain visibly changing the board, a trapped piece visibly held" |

- **Concurrency rule:** at most one *blocking* chain (beats 0–4) at a time; `AMBIENT` cues layer
  freely and are never blocking. Since Pokémon Chess resolves one action at a time, the only real
  concurrency is `AMBIENT` ∪ one chain — which is why this model can be this simple.
- **A bonus-move chain replays beats 0–4 per sub-move**, so a 3-sub-move turn is at most
  3 × 1160 ms ≈ 3.5 s at 1× speed. That is the worst case and it is the game's best moment; it should
  be allowed to breathe. `settle()` is always one click away.
- **Speed control multiplies every beat duration by `beatScale`:** 2× (0.5), 1× (1.0), 0.5× (2.0),
  Instant (0). At `beatScale = 0` every cue completes in the frame it starts and the game is a pure
  turn-based board — and a test must assert the game is completable in that mode.
- **`prefers-reduced-motion: reduce`** sets `beatScale = 0` by default and swaps motion cues for
  static ones: the `CLASH` flash becomes a one-frame outcome badge on the square, `DEATH` becomes an
  immediate removal with a fade, `GRANT` becomes a persistent (non-pulsing) aura plus the banner.
  `global.css` already has the media query scaffolding; this makes it a first-class mode rather than a
  blanket duration override.
- Every beat also writes a line to an `aria-live="polite"` log ("Charizard takes Venusaur — super
  effective — Charizard moves again"). That is the accessibility path *and* the legibility path
  DIRECTION.md's "legibility under load" constraint demands, and it costs nothing.

#### 6.5 Particle pools, so effects cannot allocate

One pre-allocated struct-of-arrays pool, sized at the 1,200 budget:

```ts
// 1200 particles x 9 float32 = 43 KB, allocated once, never grown.
const px = new Float32Array(1200), py = new Float32Array(1200);
const vx = new Float32Array(1200), vy = new Float32Array(1200);
const life = new Float32Array(1200), maxLife = new Float32Array(1200);
const size = new Float32Array(1200);
const tint = new Uint8Array(1200);      // index into the 18 type colours
const layer = new Uint8Array(1200);     // 0 = fx-under, 1 = fx-over
let liveCount = 0;                       // pool is compacted, so the draw loop is contiguous
```

Emitters request `n` particles and get `min(n, remaining)`. **Over-budget degrades gracefully**: an
emitter denied particles reduces density but keeps its silhouette, so the frame never drops. Zero
allocation per frame means zero GC pauses, which is what removes the 42–333 ms `max` spikes visible in
the DOM rows of §1.1.

---

## PART B — The AI opponent

### 1. Why off-the-shelf engines cannot be used, and what is salvageable

#### 1.1 What actually blocks reuse

1. **The position is not expressible in FEN.** A UCI engine's entire input is a FEN string: six
   fields, one glyph per piece. Our piece carries a *type* (18), an *ability* (311 archetyped into 13),
   an *item* (536 → 12-item Kit), *Vigour* ∈ [−3,+3], a non-volatile *status* (7), up to 4 *move slots
   with charges*, and per-piece *ward* and *pristine* flags. There is no protocol field for any of it,
   and no engine has a parser for one.
2. **Fairy-Stockfish's variant DSL parameterises the wrong axis.**
   (<https://github.com/fairy-stockfish/Fairy-Stockfish/wiki/Variant-configuration>) It is genuinely
   powerful — ~90 variants, custom piece movement via Betza notation, custom boards, custom win
   conditions. But every knob is about **geometry and global rules**. There is no way to express
   "capture legality is a function of an 18×18 table indexed by attacker and defender *attributes*",
   no way to express mutual destruction conditional on that table, no chance nodes, and no per-piece
   mutable attributes. Encoding our 18 types as 18×6 = 108 distinct piece types is theoretically
   possible and practically hopeless: the piece-value tables, the NNUE input and the move generator all
   scale with piece-type count, and it still cannot express the one-shot ward.
3. **NNUE evaluation is architecturally locked to 12 input planes** (piece × colour × square). Ours
   needs at minimum 18 more per side, and the network would have to be retrained from a self-play
   corpus that does not exist. The measured lesson from `recon-variants.md` §1.6 — Betza's
   "balanced" armies scoring +62%/−71% over 400 engine games — is that this domain's evaluation
   cannot be borrowed at all; it has to be fitted.
4. **Three alpha-beta invariants are actually false in this variant.**
   - **Null-move pruning** (<https://www.chessprogramming.org/Null_Move_Pruning>) assumes "having the
     move is an advantage, so if passing still beats beta, the real move surely does". Under mutual
     destruction, *being forced to act* is frequently bad (a piece with a 0.5× matchup against
     everything nearby would rather stand still), so zugzwang-like positions are common rather than
     rare. **Disable null-move pruning in v1.** Re-enable only behind a measured self-play A/B.
   - **Static Exchange Evaluation** (<https://www.chessprogramming.org/Static_Exchange_Evaluation>)
     assumes an exchange on one square resolves by comparing values down a recapture chain. Under
     mutual destruction the attacker can die *whether or not* there is a recapture. Classical SEE is
     not merely imprecise here, it has the wrong sign on a large class of moves. Replace it (§5.2).
   - **"In check" as a search concept does not exist** under the king-capture model
     (`recon-variants.md` §5, R1–R2). Check extensions, check evasion move generation, and
     `is_checkmate()` all go away — replaced by "the enemy king is capturable", which is *cheap* and
     *terminal*, and by the `T3` rule that exposing the enemy king ends your turn.
5. **Randomness breaks the determinism alpha-beta assumes.** Not fatally — see §3 — but it means the
   plain algorithm is not the right one out of the box.

#### 1.2 What is salvageable — and it is most of the engineering

Everything about *managing a tree* transfers; nothing about *chess semantics* does.

| Salvageable | Why it survives | Status |
|---|---|---|
| Iterative deepening + aspiration windows | pure tree management | **measured working**, EBF 3.8–4.2 |
| Zobrist hashing (<https://www.chessprogramming.org/Zobrist_Hashing>) | needs a *factorised* key (§4) | **measured working** |
| Transposition table | value cutoffs weaken (§4); still the best move-ordering cache | **measured**: removing value cutoffs costs ~1 ply |
| Killer heuristic, history heuristic | ordering only | **measured working** |
| PVS / null-window re-search (<https://www.chessprogramming.org/Principal_Variation_Search>) | ordering only | recommended |
| Quiescence search (<https://www.chessprogramming.org/Quiescence_Search>) | needs a variant "unstable" predicate (§5.3) | **measured working** |
| MVV-LVA | needs the outcome-aware clash value instead of raw victim value (§5.2) | recommended |
| Late move reductions (<https://www.chessprogramming.org/Late_Move_Reductions>) | ordering-dependent, safe | v2 |
| Lazy evaluation (<https://www.chessprogramming.org/Lazy_Evaluation>) | **critical here** — the good eval terms cost 6.5× (§5.1) | recommended |
| Repetition detection via the hash | must count **sub-moves** (`recon-variants.md` §4.3), and must **exclude the RNG counter** — that doc's warning is exactly right | required |
| `chess.js@1.4.0` as a **test oracle** | already in devDependencies; property-test our generator against it on positions where the variant reduces to chess (all types neutral, no abilities/items) | required |
| `src/engine/board.ts`'s precomputed tables | `RAYS`, `BETWEEN`, `KNIGHT_MOVES`, `KING_MOVES`, `PAWN_ATTACKS` are exactly the hot-path tables a searcher wants, and the comment in that file says so | **already built** |
| **Not salvageable** | NNUE, opening books, endgame tablebases, null-move pruning, classical SEE | — |

### 2. What was measured

I built a working variant searcher in Node (V8 — the same engine a Web Worker runs) with **real
variant rules**: the true 18×18 effectiveness table from `@pkmn/data` (which independently reproduces
`recon-variants.md` §2.1 exactly — **8 illegal / 61 mutual-destruction / 204 neutral / 51
super-effective** of 324 ordered pairs), type-illegal captures excluded from generation, mutual
destruction on 0.5×, bonus sub-moves on 2× capped at 3 sub-moves, and king capture as the terminal.

**Branching factor** over 120 plies of random play from a randomly-typed start position:

| Quantity | Measured |
|---|---|
| Mean legal moves per position | **30.9** (max 46) |
| Mean captures available | **3.27** |
| Mean *super-effective* captures available | **0.34** |

Two consequences: (a) our branching factor is essentially chess's (~31 vs ~35 — the 8 illegal type
pairs shave a little), which puts us squarely in alpha-beta's home territory rather than MCTS's;
(b) bonus-move chains are **rare** — 0.34 SE captures available per position means the average turn is
~1.05 sub-moves, so extra moves cost the search almost nothing in practice while being the game's
headline mechanic.

**Search throughput**, iterative deepening with TT + killers + history + quiescence
(`tech-recon-search2.mjs`):

| Depth | Nodes | Time | Mnps | EBF | TT hit% |
|---|---|---|---|---|---|
| 6 | 71,771 | **11.4 ms** | 6.30 | 2.99 | 25.7 |
| 7 | 278,190 | **38.9 ms** | 7.15 | 3.88 | 24.2 |
| 8 | 1,056,245 | **148 ms** | 7.12 | 3.80 | 25.6 |
| 9 | 4,192,983 | **577 ms** | 7.27 | 3.97 | 26.8 |
| 10 | 17,540,249 | **2,460 ms** | 7.13 | 4.18 | 29.2 |
| 11 | 90,022,411 | 12,985 ms | 6.93 | 5.13 | 30.8 |

**7.1 M nodes/sec in plain JavaScript**, EBF ≈ 4. For calibration: without a TT, killers or history
(the first, naive version — `tech-recon-search.mjs`) the EBF was **28–42** and depth 8 took 24 s. The
ordering machinery is worth ~3 plies and it all transfers from chess unchanged.

**Cost of each eval term** (`tech-recon-eval.mjs`):

| Operation | ns/call | Relative to material eval |
|---|---|---|
| Read an incrementally-maintained material accumulator | **4** | 0.05× |
| Material eval, 64-square scan with a type-aware value table | **76** | 1.00× |
| `genMoves` for one side, full board | **194** | 2.55× |
| Material + **mobility** (needs both sides' move counts) | **470** | **6.17×** |
| Material + **super-effective-threat scan** | **496** | **6.50×** |

Implied search speed if a node costs one `genMoves` plus one eval: 5.05 Mnps (incremental) / 3.70
(material scan) / **1.51 (with mobility)** / 1.45 (with threats). So naively adding the good eval
terms at every leaf costs **2.4×**, i.e. ~1.25 plies. §5.1 says what to do about it.

### 3. Chance nodes: the measured answer

`tech-recon-chance.mjs` and `tech-recon-star.mjs`, same position, same searcher, five randomness
models:

| Model | depth 5 | depth 6 | depth 7 | depth 8 | vs deterministic @ d6 |
|---|---|---|---|---|---|
| **Deterministic** (type chart only) | 4.0 ms | **16.1 ms** | 97 ms | 610 ms | **1.0×** |
| Full expectiminimax, 3-way chance node per capture (MISS ⅙ / CRIT ⅙ / TYPE ⅔) | 106 ms | **1,946 ms** | — | — | **121×** |
| …**+ star1 pruning**, bounds ±4500 cp | 70 ms | **1,652 ms** | 15,741 ms | — | **103×** |
| **Input randomness** (public per-turn CRIT/FLINCH type), 1 sample per ply | 5.7 ms | **20.6 ms** | 100 ms | 604 ms | **1.28×** |
| Input randomness, **3 samples per ply** | 732 ms | **8,544 ms** | — | — | **531×** |
| EV-collapse of a post-commitment d6 (one child + a static correction) | 7.7 ms | 26.7 ms | 470 ms | 2,026 ms | **1.66×** |

*(A separate run with the same probe measured 159× at depth 6 for the naive chance-node model; the
121× above is from the second probe with slightly different ordering. Both are the same conclusion.)*

Four conclusions, each with a number behind it.

**(a) Full chance-node enumeration is unaffordable.** ~100–160× at depth 6 ≈ **4 plies of depth**
surrendered. A depth-9 engine becomes a depth-5 engine. Depth 5 in this variant does not see a
two-capture combination through a bonus move.

**(b) Star1 does not rescue it, and the reason is structural.** Ballard's *-minimax
(<https://www.chessprogramming.org/Star1>, and Ballard 1983, *Artificial Intelligence* 21(3),
<https://doi.org/10.1016/S0004-3702(83)80015-0>) recovers alpha-beta bounds at a chance node by
using static bounds `[L,U]` on any child's value:
`A_i = (α − Σ_{j<i} p_j v_j − U·Σ_{j>i} p_j) / p_i`. Its power is entirely in how tight `L,U` are.
In our game a single capture can swing 950 cp and a king capture is ±29,000 — so honest bounds are
wide, `A_i` falls below the score floor almost always, and the cut never fires. **Measured saving:
20%.** Star2 (probing the most-likely child first to tighten the bound) would do better, but it
cannot fix a domain where the outcome distribution genuinely spans "I win the game" to "I lose my
queen". *Verdict: not worth the complexity.*

**(c) Input randomness is the answer, and it costs 10–28%.** `recon-variants.md` §6.3 already
recommends revealing the turn's random state publicly at turn start ("a CRIT type… and a FLINCH
type… Both players see both") on *balance* grounds — because output randomness is ~5× louder than
input randomness at equal rate. **It is independently the right AI decision, by two orders of
magnitude.** With the roll public at the start of a turn:

- The **root has no chance node at all.** The current turn's randomness is already resolved and known
  to both sides; the search over the current turn is fully deterministic.
- There is **exactly one chance node per ply boundary** (the opponent's future roll), not one per
  capture — and the number of captures per position is 3.27, so this alone is a ~3× reduction in
  chance-node count before any other trick.
- Sampling one future roll per ply and letting iterative deepening + root averaging do the smoothing
  costs **+10% at depth 6, +0% at depth 8** (604 ms vs 610 ms — inside noise).

This is the single most consequential finding in Part B: **the ruleset choice that makes the game
fairer is the same choice that makes the AI 100× cheaper.** If the design ever reverts to
post-commitment rolls, the AI loses 4 plies and the difficulty ladder collapses by ~400 Elo.

**(d) Sampling must happen at the root, never in the tree.** In-tree sampling with k samples costs
≈ k^depth: k=3 measured at **531×** (8,544 ms at depth 6). The correct structure is:

```
bestMove(state, budgetMs, R):
  futures = [ rngFork(state.rng, i) for i in 0..R-1 ]      # R fixed sampled futures, seeded
  scores  = Map<Move, number>
  for i in 0..R-1:                                          # common random numbers:
      # every root move is evaluated against the SAME future i, so the comparison is paired
      run one full iterative-deepening search with futures[i] driving every chance node
      accumulate each root move's score into scores
  return argmax(scores[m] / R)
```

Cost is **linear in R**, and common random numbers (the same future for every root move) removes most
of the sampling variance because the comparison is paired rather than independent. Measured budgets:
R = 6 at depth 8 ≈ 6 × 604 ms = **3.6 s**; R = 6 at depth 7 ≈ **0.7 s**; R = 4 at depth 8 ≈ **2.4 s**.
`src/engine/rng.ts` already gives us exactly the primitive needed — a 4-word serialisable state, so
`rngFork` is a pure function and every sampled future is reproducible in a replay.

If any post-commitment d6 survives (a `willCrit` move, `Quick Claw`'s 20%, `Focus Band`'s 1-in-6),
model it with the **EV-collapse** child: resolve the modal outcome and add a static probability
correction (`−p_miss · value(attacker) + p_crit · τ`). Measured cost 1.66× ≈ 0.4 plies, and the exact
distribution is shown to the player at the root anyway (`recon-variants.md` R3 makes this a UI
obligation).

#### 3.1 Why not MCTS/UCT, and why not flat Monte Carlo

**MCTS/UCT** (<https://www.chessprogramming.org/UCT>; Browne et al., *A Survey of Monte Carlo Tree
Search Methods*, IEEE TCIAIG 2012, <https://ieeexplore.ieee.org/document/6145622>) is the right tool
when the branching factor is huge, the position is hard to evaluate statically, and tactics are
shallow. Our domain is the opposite on all three counts:

- **Branching factor 30.9, measured.** MCTS's advantage over alpha-beta grows with branching (Go: 250).
  At 31 with EBF 4 after ordering, alpha-beta reaches depth 9–10 in a second; UCT with a comparable
  budget explores a few hundred thousand playouts spread over a tree it cannot prune.
- **We have a good static evaluation** — `recon-variants.md` §3.2 hands us a *derived, principled*
  type-aware piece-value formula with precomputable 18×18 tables. That is exactly the asset alpha-beta
  monetises and MCTS wastes.
- **Tactics are sharp and deep.** A super-effective capture grants a bonus move; a bonus move can
  itself capture; mutual destruction means a defended piece is not safe. These are 4–8 ply
  calculations with narrow correct lines. Alpha-beta with quiescence finds them; UCT's averaged
  backups smear them.
- **Random rollouts are worse than useless here.** In a mutual-destruction game, random play
  annihilates both armies in a few dozen plies, so a random-policy rollout's terminal value carries
  almost no information about the root. Fixing that needs a learned policy network (AlphaZero,
  <https://www.science.org/doi/10.1126/science.aar6404>), which needs a self-play pipeline and GPU
  training we do not have and which would not fit in a 110 KB bundle.
- MCTS *does* handle chance nodes gracefully (they are just another sampled child) — but §3(c)
  already reduced our chance-node cost to +10%, so that advantage buys nothing.

**Where MCTS *is* the right answer, and we should use it there:** the **draft**. Drafting is a
32-pick sequential game with a combinatorial action space, no useful notion of depth, and an
evaluation that only exists at the end (the army pairing's win probability). That is textbook UCT, and
`recon-variants.md` §1.6's Chess18 recommendation ("engine-evaluate candidate pairings, publish the
eval, ban or handicap the tails") is exactly a rollout-based procedure. Budget it as a v2 offline
tool, not an in-game search.

**Flat Monte Carlo** (sample N random continuations per root move, average) is rejected outright: with
EBF 4 and 7 Mnps, alpha-beta sees a forced 4-move combination in 11 ms. Flat MC never sees it at any
budget, because it has no notion of the opponent replying correctly.

### 4. Extra-move chains, state-dependent legality, and the transposition table

#### 4.1 A ply is a sub-move, not a turn

`recon-variants.md` §4.1 proves the chain bound (`L ≤ 1 + N ≤ 17`) and §4.2 ships `T1: L ≤ 3`. The
search consequence is that **the side to move does not alternate at every node**. The recursion must
carry `(sideToMove, chainLeft, bonusPieceMask)` and, on a bonus sub-move, recurse **without negating**:

```ts
if (isCapture && effectiveness === SUPER && chainLeft > 0 && !bonusPieceMask.has(from)) {
  score = search(state, side, depth - 1, alpha, beta, chainLeft - 1, bonusPieceMask | bit(to));
} else {
  score = -search(state, -side, depth - 1, -beta, -alpha, /*chainLeft*/ 2, /*mask*/ 0);
}
```

This is a small change with four knock-on effects, each of which is a bug if missed:

1. **Depth is measured in sub-moves**, so a nominal depth of 9 is ~8.6 turns (0.34 SE captures per
   position ⇒ ~1.05 sub-moves per turn, measured). Do not report "depth" to the player as "moves
   ahead".
2. **Mate-distance scores must be `29000 − subMoveCount`**, not `− ply`, or the engine prefers a
   slower king capture. My probe does this and it is why king-capture lines are found correctly.
3. **Progress and repetition counters count sub-moves**, matching `recon-variants.md` §4.3's
   "100 consecutive **sub-moves**". A turn-based counter under-counts by ~5% and, worse, is not
   monotonic across a chain.
4. **The `T3` rule (exposing the enemy king ends your turn) needs a cheap test after every sub-move.**
   Do *not* run a full `genMoves` for the opponent (194 ns × every sub-move). Instead run
   `isAttacked(enemyKingSquare, bySide)`: an 8-ray walk from the king square plus the knight ring plus
   the pawn-attack table — all of which `src/engine/board.ts` already precomputes. ~30 table lookups,
   ≈15 ns. Note it must respect type legality (a Ground piece does not "expose" a Flying king), so it
   is `attackersOf(sq)` filtered by `EFF[attackerType][kingType] !== 0`.

**One rules recommendation from the AI side:** make the bonus sub-move **optional** — generate an
explicit `DeclineBonus` action at bonus nodes. Reasons: (i) a mandatory extra move can *force* a
player into a self-harming capture, which is a zugzwang mechanic nobody designed and players will
report as a bug; (ii) the search needs the decline branch anyway to evaluate the chain honestly;
(iii) it is one line in move generation and it removes a whole class of degenerate lines. This is
consistent with `recon-variants.md`'s Marseillais precedent, where the *count* of moves is fixed but
each is chosen freely.

#### 4.2 State-dependent legality: the ward problem, quantified

`recon-abilities-items.md` §6.1 makes every ward **one-shot** (Air Balloon as the template), and §8
question 5 flags the consequence: *"Move generation is no longer a pure function of piece positions —
it depends on per-piece ward flags. Flag this early; it affects transposition-table keys."* That
warning is correct, and here is what it costs.

**What the legal move set actually depends on:**

```
generate(state) = f( occupancy, pieceClass, pieceType, wardIntact, boundBy,
                     status(slp/frz ⇒ cannot move; par ⇒ halved range),
                     itemPresent (Iron Ball, Ring Target, Shed Shell, Choice lock),
                     abilityArchetype (WARD/EDGE-pierce/BIND/STRIDE),
                     fieldState (Gravity disables RAY_ANY; terrain),
                     hazardLayers,
                     publicRoll (FLINCH type ⇒ that type cannot capture this turn),
                     chainLeft, bonusPieceMask )
```

**The Zobrist key must be factorised, not a product.** The naive approach — one key per
(square × pieceCode × type × ward × vigour × status × …) — is 82 million keys. The correct approach is
one **independent** table per state dimension, XORed together
(<https://www.chessprogramming.org/Zobrist_Hashing>):

| Table | Entries | Notes |
|---|---|---|
| `Z_piece[square][pieceCode]` | 64 × 13 = 832 | side encoded in `pieceCode` |
| `Z_type[square][type]` | 64 × 18 = 1,152 | **this is the one a chess engine does not have** |
| `Z_ward[square]` | 64 | XOR in while the ward is intact |
| `Z_vigour[square][v+3]` | 64 × 7 = 448 | `recon-abilities-items.md`'s single [−3,+3] counter |
| `Z_status[square][st]` | 64 × 7 = 448 | none/slp/par/psn/tox/brn/frz |
| `Z_charges[square][slot][n]` | 64 × 4 × 6 = 1,536 | 4 move slots, 0–5 charges |
| `Z_pristine[square]`, `Z_item[square]` | 128 | |
| `Z_side`, `Z_chain[0..2]`, `Z_crit[18]`, `Z_flinch[18]` | 40 | the public roll **must** be in the key |
| `Z_field[weather][terrain]`, `Z_hazard[square][layer]` | ~300 | |
| **Total** | **≈ 6,500 keys × 2 × 32 bits = 52 KB** | trivial; allocate once at module load |

My probe implements the first two tables (64 × 13 × 18 = 14,976 keys) with incremental XOR through
make/unmake and it works — the incremental hash is ~2 ns per move.

**Two things the key must NOT contain**, both of which are silent-failure traps:

- **The PRNG counter.** `recon-variants.md` §4.3 already flags this for repetition detection: a
  monotonic RNG state makes repetition unreachable by construction. Same problem for the TT: it makes
  every key unique and the table useless.
- **Anything the mover cannot observe.** With everything public (`recon-abilities-items.md` §4.2
  makes abilities and items public), this is satisfied — which is a real, unremarked benefit of that
  decision. Hidden information would force the AI into an information-set search, a different and much
  harder algorithm. `Illusion` is the one sanctioned exception and it should be modelled as a *known*
  decoy from the AI's side (the AI plays it honestly; the human is the one who is fooled).

**What the extra state costs, measured.** More state in the key ⇒ fewer real transpositions ⇒ fewer
TT *value* cutoffs. I measured the extreme case by keeping the TT purely as a best-move cache and
disabling value cutoffs entirely (`tech-recon-search2b.mjs`, `TT_VALUES=0`):

| Depth | TT value cutoffs ON | TT as move-cache only | Cost |
|---|---|---|---|
| 8 | 154 ms (EBF 3.80) | 435 ms (EBF 4.86) | 2.8× |
| 9 | **601 ms** (EBF 3.97) | **2,069 ms** (EBF 5.01) | **3.4×** |
| 10 | 2,533 ms (EBF 4.18) | 11,207 ms (EBF 5.40) | 4.4× |

**≈1 ply at a 1-second budget.** Acceptable, and mitigable:

- **Epoch-split the key.** Hash the *slow-moving* state (types, wards, items, abilities, field) into a
  single `epoch` word that changes only on a rare event — a ward popping, a Tera, a type mutation, a
  weather change. Use `(Z_piece ⊕ Z_side ⊕ Z_chain ⊕ Z_roll ⊕ epoch)` as the probe key. Transpositions
  *within* an epoch — which is the overwhelming majority of a search — still work. Epochs change at
  most a couple of dozen times per game (at most 8 wards per side, one Tera per side).
- **Keep the TT even when value hits are rare.** The measurement above still had full move ordering
  from the TT's best-move field, and the alternative (no TT at all, `tech-recon-search.mjs`) had EBF
  28–42. The best-move cache is worth ~3 plies on its own.
- **Always validate a TT move before playing it.** Because legality is state-dependent, a stale TT
  entry can hand back a move that is now illegal (the ward popped, the piece is bound, its type
  changed). Verify membership in the freshly generated list. This is 20 lines and it is the difference
  between an engine that works and one that occasionally plays an illegal move.

**On incremental move generation: don't.** A dirty-piece incremental attack table is where variant
engines acquire their hardest bugs, and it is exactly what state-dependent legality makes fragile — a
ward popping invalidates attack sets that have nothing to do with the piece that moved. `genMoves`
costs a **measured 194 ns** for a full board, which is ~35% of a node. Spend the engineering on
ordering, which is measurably worth 3 plies, not on saving 35% (worth 0.2 plies).

Do keep the two accumulators that are trivially correct because they are pure sums:

1. **Type-aware material.** Measured 4 ns to read vs 76 ns to rescan — a 19× saving on the term
   evaluated at every single leaf. Update in make/unmake: `acc += sign · PVAL[class][type]`.
2. **A per-side 18-element type-count vector.** `recon-variants.md` §3.3 needs it for
   `LIAB/ARM/BLOCK/BONUS` with live weights `ŵ`, and states the requirement precisely: "O(1) per
   capture, no per-node loop over 18 types". Two `Int8Array(18)`s, incremented and decremented on
   make/unmake.

### 5. The evaluation function

#### 5.1 Shape, and the tier each term sits in

The cost measurements in §2 dictate the structure: terms are placed in tiers by how often they can
afford to be computed.

```
eval(state, side) =
  ── TIER 0: incremental, 4 ns, every node ────────────────────────────────────────────
    Σ_p sign(p) · [ m(class_p) · (1 − α·LIAB(t_p, ŵ) + β·ARM(t_p, ŵ) − ε·BLOCK(t_p, ŵ))
                    + τ·BONUS(t_p, ŵ) ]                    // recon-variants.md §3.2 verbatim,
                                                           //   α=0.9 β=0.5 ε=0.3 τ=0.5(=50cp)
  + Σ_p sign(p) · PST[class_p][square_p]                   // ordinary chess piece-square tables
  + w_tempo · (side has the move)
  + w_ward  · (wardsIntact(us) − wardsIntact(them))        // a one-shot ward ≈ half a tempo (25cp).
                                                           //   Betza values permanent uncapturability
                                                           //   at 5–10×; one-shot is nothing like that,
                                                           //   and pricing it high would make the AI
                                                           //   hoard wards instead of spending them
  + w_stat  · (statusScore(us) − statusScore(them))        // slp/frz = the piece is worth ~0 for
                                                           //   d6 mod 3 + 1 turns; par = −15% of m;
                                                           //   brn = −1 on its clash rolls ≈ −8% of m;
                                                           //   psn/tox = a countdown, priced by turns left
  + w_chain · (chainLeft > 0 ? 40 : 0)                     // holding an unspent bonus move is real value

  ── TIER 1: lazy, ~470 ns, only when |tier0 − α| < MARGIN (≈250 cp) ──────────────────
  + w_mob   · (mobility(us) − mobility(them))              // legal sub-moves, capped at 12/piece so a
                                                           //   queen doesn't dominate the term
  + w_king  · (kingRing(them) − kingRing(us))              // weighted attackers on the 8 squares around
                                                           //   each king. NO check term — king capture
                                                           //   is terminal, so "check" is not a state
  + w_haz   · hazardPressure                               // Σ over enemy hazard squares of
                                                           //   P(we must step there) × layer cost
  + w_bind  · boundPieces(them) − boundPieces(us)          // a bound piece's mobility is already counted;
                                                           //   this prices the positional lock on top

  ── TIER 2: root only, once per search, ~50 µs ───────────────────────────────────────
  + w_cov   · typeCoverage(us) − typeCoverage(them)        // |{ enemy types we can hit at ≥1× }| / 18.
                                                           //   This is the term that punishes a
                                                           //   Normal-heavy army (0 super-effective
                                                           //   matchups, recon-variants.md §2.2) and it
                                                           //   changes only when a piece dies or Teras
  + w_supply· scarce-type ownership (Steel: 11/18 SAFE)    // slow-moving, army-level
```

**Why the tiering.** Mobility and threats measured at 6.2–6.5× the material eval, which is 2.4× on
total search speed ≈ 1.25 plies. Lazy evaluation recovers almost all of it because most leaves are
far outside the window. Coverage and supply are *army-level* quantities that change only on a capture,
so recomputing them per node is pure waste.

**The threat term is free — put it in quiescence.** Quiescence already enumerates every capture at
every leaf. While doing so, accumulate `Σ staticClash(a,d)` over the generated captures. That is a
better threat term than a separate static scan (it is *actual* available captures, correctly
type-filtered) and it costs nothing extra. This is the single best structural idea in the eval: the
term that measured most expensive as a static scan is free as a by-product of a search we already run.

**Weights must be fitted, not chosen.** `recon-variants.md` §1.6 is unambiguous: Betza's four
hand-balanced armies were pronounced equal by human masters and later scored
**+62% / +19% / −11% / −71%** over 400 engine games. Ship the starting coefficients from
`recon-variants.md` §3.2 (α 0.9, β 0.5, ε 0.3, τ 0.5) as *initial* values, then run self-play
(SPSA or a simple Texel-style tuning against a self-play corpus) and re-tune. Budget 2 weeks for the
harness and the first calibration; treat it as ongoing.

#### 5.2 The replacement for SEE: outcome-aware static clash

This is the most important single function in the AI, because it drives move ordering, quiescence
pruning, and the "is this capture good?" question the whole game turns on.

```ts
/** Expected material delta of capturing `d` with `a`, before any search. Pure table lookups. */
function staticClash(a: Piece, d: Piece, roll: PublicRoll): number {
  const e = EFF[a.type][d.type];              // 0 | 0.5 | 1 | 2   (Uint8Array(324))
  if (e === 0) return ILLEGAL;                // never generated
  const isCrit  = roll.critType === a.type;   // input randomness: known, not sampled
  const bonus   = e >= 2 || isCrit;
  const dies    = e === 0.5 && !isCrit;       // deterministic mutual destruction
  return value(d)
       - (dies ? value(a) : 0)
       + (bonus ? TAU : 0)                    // TAU = 50 cp, recon-variants.md's τ
       - (a.item === 'lifeorb' ? VIGOUR_CP : 0);
}
```

This is exactly `recon-variants.md` §2.4B's `E[Δ] = v − P(death)·u + P(bonus)·τ`, evaluated with the
*known* roll rather than an expectation — which is what input randomness buys us. It reproduces that
document's key finding automatically: a queen taking an undefended knight is worth only +0.53 pawns,
so the AI will correctly stop throwing queens at minor pieces, which is the behaviour that makes it
feel like it understands the game.

Ordering key: `staticClash` descending, then TT move, then killers, then history. Quiescence
generates only captures with `staticClash > −MARGIN` plus all captures that could remove a king.

#### 5.3 What "quiescent" means here

In chess, a position is quiet when there are no captures. Here there are two more sources of
instability, and both must be searched or the eval is systematically wrong:

1. **Any capture is unstable**, including a losing one, because mutual destruction means a capture can
   *cost* the mover a piece independent of recapture. Classical "only search winning captures"
   pruning is wrong.
2. **An unspent bonus move is unstable.** A leaf reached with `chainLeft > 0` and a super-effective
   capture available is not a resting position. The quiescence search must follow bonus chains — my
   probe does this (`if (e === SUPER) qsearch(sameSide, ...)`) and it is why the depth figures in §2
   are honest.
3. **A pending delayed effect is unstable** (Future Sight, Doom Desire, Perish Song, Wish — the D5
   class in `recon-moves.md` §5). Horizon-extend by the pending duration, which is bounded at 5 by the
   dataset (`condition.duration` max = 5), so the extension is provably finite.

### 6. Engineering

#### 6.1 Web Worker: mandatory, not an optimisation

Think time is up to 3 s; a frame is 16.7 ms. The search is **180× a frame**, so it can never run on
the main thread without the board freezing —
[Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API) are the only option.

Protocol (structured-clone only; no `SharedArrayBuffer`, which needs COOP/COEP headers we should not
require for a static site):

```
main ──▶ worker   { type: 'search', state: SerialisedGameState, budgetMs, difficulty, rootSeed }
main ──▶ worker   { type: 'stop' }                       // player moved / took back / changed setting
worker ──▶ main   { type: 'progress', depth, score, pv, nodes, nps }   // every ~100 ms
worker ──▶ main   { type: 'result', move, score, depth, nodes, pv }
```

- `SerialisedGameState` is the engine's own plain-object state (BRIEF §4.2 already requires the engine
  be pure and serialisable) — so there is no separate marshalling layer, and the same bytes are the
  replay format and the future network payload. Measured relevance: the whole position is ~64 × ~12
  bytes plus a little side state, ≈ 1 KB — structured-clone cost is negligible next to a 600 ms search.
- The worker imports **only** `src/engine/**` and the baked data — never React, never `src/ui/**`.
  Enforce with a lint rule; it also keeps the worker chunk small and independently cacheable.
- A `stop` message sets a flag the search checks on its node-count boundary, so a take-back is
  instant.
- Data loading in the worker: the searcher needs the type chart (0.33 KB), the packed move-effect
  table (~21 KB) and the ability/item archetype records (~0.7 KB) — **~22 KB**, not the 274 KB dex. It
  must never import `species.json` or `learnsets.json`.

#### 6.2 WASM: no, and here is the arithmetic

Measured JS throughput: **7.1 Mnps**. For scale, strong native chess engines run 5–50 Mnps
single-threaded with far heavier move generation, so a JS implementation at 7 Mnps on this workload is
already within a small factor of native. Jangda et al., *Not So Fast: Analyzing the Performance of
WebAssembly vs. Native Code* (USENIX ATC 2019, <https://www.usenix.org/conference/atc19/presentation/jangda>)
measured WebAssembly at 1.45–1.55× *slower than native C* on SPEC — so WASM is not a route to native
speed, and the realistic win over well-JITed typed-array JS on a branchy, small-working-set search is
**1.5–2.5×**.

At EBF 4.0, a 2× speedup buys `log₄(2) = 0.5 plies`. Half a ply. In exchange for Rust in the
toolchain, a second debugging story, a larger worker chunk, and a build step. **Reject.**

Four things each buy more than WASM would, in descending order:

| Change | Measured / expected gain |
|---|---|
| Keep resolution deterministic-within-a-turn (input randomness) | **~4 plies** (measured 100–160×) |
| Epoch-split the TT key so value cutoffs survive state-dependence | **~1 ply** (measured 3.4× at depth 9) |
| Lazy evaluation of the mobility/threat tier | **~1.25 plies** (measured 2.4×) |
| LMR + futility pruning | ~1–2 plies (standard, unmeasured here) |

**One WASM-shaped opportunity to keep on file for v3:** 64-bit bitboards. Move generation is a
measured 194 ns / 35% of node cost, and bitboard generation would cut it several-fold — but JS has no
fast 64-bit integer type (`BigInt` is far slower than two 32-bit halves, and the two-half trick eats
most of the win). WASM's native `i64` is exactly the capability JS lacks. *If* move generation ever
becomes the bottleneck, that is the case where WASM is genuinely the right tool. It is not the case
today.

Similarly, **Lazy SMP across 4 workers** (~1.7–2.5× in chess engines) buys another ~0.5 ply and costs
a shared TT, which needs `SharedArrayBuffer` and COOP/COEP headers. Not v1.

#### 6.3 Iterative deepening and time management

```
search(budgetMs):
  best = firstLegalMove                              # never return nothing
  for depth in 1..MAX:
      score, move = rootSearch(depth, windowAround(prevScore))
      if aborted: break                              # keep `best` from the last COMPLETE iteration
      best, prevScore = move, score
      elapsed = now()
      # EBF is measured at ~4.0; predict the next iteration and stop early rather than abort late
      if elapsed * 4.0 > budgetMs * 0.85: break
  return best
```

- **Clock checks every 4096 nodes.** At 7.1 Mnps that is 0.58 ms of granularity — fine for a 350 ms
  floor, and the check itself is amortised to nothing.
- **Always return the last *completed* iteration's move.** A partially searched iteration can return a
  worse move than the previous depth; this is the classic bug.
- **Aspiration windows** around the previous iteration's score (±50 cp, widening on failure). With
  root-level Monte Carlo averaging over R futures, reuse future *i−1*'s score as future *i*'s
  aspiration centre — they are highly correlated because of common random numbers.
- **A 350 ms minimum think time even when the answer is instant** (mate in 1, one legal move). An
  opponent that replies in 4 ms reads as a script, not a player. Fill it with the "thinking" HUD and
  the eval bar from the `progress` messages.

### 7. Difficulty levels that differ in kind

The thematic opportunity here is unusually clean, and it is the answer to a real design problem: an AI
made weak by shallow search plays *incoherently* (it makes random-looking positional errors), whereas
an AI made weak by **not knowing the type chart** plays *coherently but wrongly* — which is exactly
how a human who is good at chess and new to Pokémon plays. It is also **learnable**: the player can
notice "this opponent doesn't know Steel resists Fairy" and exploit it, which teaches the type chart
through play rather than through a manual (BRIEF hard problem 9).

**Mechanism.** The engine resolves captures with the true chart from `src/engine/typechart.ts`. The
searcher takes its `Uint8Array(324)` effectiveness table as a **parameter**, and each difficulty
supplies a different one. Three lines of code; the entire difficulty ladder hangs off it.

| Level | Type chart the AI searches with | Depth / budget | Other |
|---|---|---|---|
| **Rookie** ≈ 800 | Only the matchups a beginner actually knows: the starter triangle (Fire>Grass>Water>Fire), Electric>Water, Ground>Electric, Water>Fire. **All other 0.5× and 2× entries flattened to 1×; all 8 immunities hidden** (it will attempt illegal captures and be rejected — which the UI should show as the AI making a mistake, not as a bug) | 2 sub-moves, 200 ms | Blunders by *misjudging types*, never by random move choice |
| **Trainer** ≈ 1200 | Correct on the common matchups; **wrong on all 8 immunities and on Steel's 10 resistances** — the two things intermediate players demonstrably get wrong (`recon-variants.md` §2.2 identifies Steel as the most contested and most misunderstood type) | 4, 400 ms | 15%/turn chance of playing the 2nd-best root move |
| **Gym Leader** ≈ 1600 | **Correct** | 6, 700 ms | Tier-0 eval only — no mobility, no coverage, no hazard terms. Sound tactics, poor strategy |
| **Elite Four** ≈ 1900 | Correct | 8, 1.5 s, R = 4 root samples | Full Tier-0+1 eval; Tier-2 at root |
| **Champion** ≈ 2100+ | Correct | ID to budget (9–10), 3 s, R = 8 | Everything on; opening randomisation off |

Two further levers, both with prior art already collected:

- **Army quality as difficulty** — Really Bad Chess deals armies "based on the player's skill level"
  (`recon-variants.md` §1.6, §6.3 knob 5). Give the easy AI a smaller draft budget rather than a worse
  brain. This produces a *sound* opponent in a *losing* position, which is far more instructive than a
  blundering opponent in an equal one, and it is a one-line change in the draft.
- **Contempt / risk appetite**, not strength: a "Reckless" personality with a negative draw score and
  a higher `τ` will hunt bonus-move chains and mutual-destruction trades; a "Cautious" one with a high
  `α` will avoid them. Same search, same depth, different *character*. This is nearly free and it makes
  a 5-opponent roster feel like 5 opponents.

**Elo caveat, stated honestly.** The numbers above are calibrated by analogy to chess engines at the
same depth with a comparable hand-written eval; they are *estimates*, not measurements. There is no
rating pool for this variant. The only way to get real numbers is a self-play ladder plus human
games — and `recon-variants.md` §6.1 already flags that the pawn↔Elo constant it uses (1 pawn ≈ 70
Elo) is itself an assumption. Measure it after launch by fitting `P(win)` against
`(ΔElo_chess, Δtype-quiz-score)`, exactly as that document recommends.

### 8. Effort estimate

| Work | Estimate | Notes |
|---|---|---|
| **Rendering — credible first pass** | **1 week** | The 4 capture-outcome animations, piece movement, the bonus-move dramatisation, the layer stack, the presenter + beat grid, `prefers-reduced-motion`. This is the DIRECTION.md minimum. |
| Rendering — full | +2–3 weeks | Hazard/status/weather/terrain/trap visuals, the item and ability glyph sets, the draft screen, the HUD, the `aria-live` log, the sprite tiering + service worker. |
| Board refactor (pieces out of squares, CSS custom properties, layer stack) | 2 days | Prerequisite for any animation. |
| **AI — playable opponent** | **1 week** | `board.ts` already has the tables; the searcher is ~600 lines, and I have a working reference implementation in `/tmp/pkmn-probe/tech-recon-search2.mjs` that already does variant rules, TT, killers, history and quiescence. |
| AI — full | +2–3 weeks | Worker protocol, the difficulty ladder, time management, the Tier-1/2 eval terms, `staticClash`, root Monte Carlo, TT epoch-splitting, TT-move validation, illegal-move fuzzing. |
| AI — self-play weight calibration harness | +2 weeks | Non-negotiable per `recon-variants.md` §1.6/§3.3. Also produces the Chess18-style pairing screen. |
| Performance CI (bundle gates, frame-time replay test, node-count test, engine benchmarks) | 3 days | Cheap, and it is the only thing that keeps the budgets in §5 real. |

**The biggest risk in Part B is not search strength — it is ruleset churn.** Freeze a narrow interface
now and make the searcher depend only on it:

```ts
interface Rules {
  generate(s: GameState): Action[];                       // the ONE legality predicate, shared with the UI
  apply(s: GameState, a: Action): { state: GameState; events: EffectEvent[] };
  terminal(s: GameState): Result | null;
  staticClash(s: GameState, a: Action): number;           // ordering + quiescence key
}
```

Every mechanic in `recon-moves.md` and `recon-abilities-items.md` lands behind `generate`/`apply`. The
searcher then never needs to know that Rough Skin exists. `recon-variants.md` §6.4 warns that
"Guarded mode" creates two legality paths — this interface is the place to prevent that: Guarded mode
is a **filter over `generate`'s output**, never a second generator.

---

## 9. Conflicts, corrections and open questions

1. **BRIEF §4.6 (offline single-player) contradicts `recon-data-substrate.md` §6 (hotlink Showdown's
   CDN).** *Ruling:* both survive via the Cache API + a first-class text fallback (§5.2). Do not vendor
   sprites into the repo; do not ship a game that renders 32 blank squares offline.
2. **`recon-variants.md` recommends input randomness on balance grounds; I confirm it independently
   on search grounds, and the AI case is stronger than the balance case.** Measured: full chance-node
   enumeration costs 100–160× (≈4 plies) and star1 recovers only 20%; input randomness costs +10%.
   *Ruling:* input randomness is now a **joint** requirement of the balance model and the AI
   architecture. If it is ever revisited, the AI section must be re-derived, and the difficulty ladder
   drops roughly 400 Elo.
3. **`recon-abilities-items.md` §8 q5 is right, and now quantified.** One-shot wards make legality
   state-dependent, which costs ≈1 ply of search (measured 3.4× at depth 9 in the worst case) unless
   the TT key is epoch-split. *Ruling:* keep the one-shot ward — it is the best answer to the
   untouchable-piece problem — and pay for it with epoch-splitting and TT-move validation.
4. **The bonus sub-move should be optional; no doc currently says.** *Ruling (mine):* make it
   optional, generate an explicit `DeclineBonus` action. A mandatory extra move is an undesigned
   zugzwang mechanic, and the search needs the branch anyway.
5. **`recon-variants.md` §4.3's warning about the PRNG counter applies to the transposition table too,
   not just to repetition detection.** Putting RNG state in the TT key makes every key unique and the
   table dead. Worth restating because it will be written by a different person.
6. **The entry-chunk budget is a React budget.** Measured: 59.3 KB of the 65.2 KB entry chunk is React
   19 + react-dom; our own code is 5.9 KB. *Ruling:* set the gate at 110 KB gz, and if it is ever
   breached the answer is `preact/compat` (measured 4.4 KB core, ~52 KB reclaimed), not shaving
   application code.
7. **`species.json` must not be on the critical path.** 76.9 KB gz as shipped; a columnar draft index
   of the 1025 base formes measures 17.4 KB gz — 4.4× smaller, and it contains everything a draft
   screen needs. *Ruling:* add the thin chunk (§5.1).
8. **Chessground is the right architectural model and the wrong dependency.** DOM board, custom DOM
   diff, transform-positioned pieces, separate overlay layer, 12.1 KB gz measured. It is **GPL-3.0**
   and this repo is Apache-2.0. *Ruling:* study it, cite it, do not link it.
9. **My frame measurements were vsync-bound at 8.33 ms, not 16.67** — this machine has a 120 Hz
   display. A design tuned only to a 60 Hz budget will visibly judder on modern laptops. *Ruling:*
   state budgets against the 120 Hz frame (≈4 ms of JS) and treat 60 Hz as the slack case. The
   recommended architecture passes both with >2.5× margin even at a 6× hardware penalty.
10. **The 6× slow-hardware multiplier in §3 is an estimate, not a measurement.** It is the one
    unverified number in Part A. *Action:* run the same `bench.html` harness under Chrome DevTools 4×
    and 6× CPU throttling, and on one real mid-range Android, before the frame-time budget is treated
    as settled. Everything else in this document was measured.
11. **What I did not measure:** WASM (no Rust toolchain configured here, and §6.2 argues it is not
    worth adding), Lazy SMP, LMR/futility gains, real Elo. The Elo column in §7 is the softest number
    in this document; treat it as a target to verify, not a claim.

---

## 10. Sources

Rendering and web performance
- RAIL performance model (10 ms animation budget) — <https://web.dev/articles/rail>
- Animation performance and compositor-only properties — <https://developer.mozilla.org/en-US/docs/Web/Performance/Animation_performance_and_frame_rate>
- `will-change` and its costs — <https://developer.mozilla.org/en-US/docs/Web/CSS/will-change>
- WAI-ARIA APG `grid` pattern (keyboard model for a 2-D board) — <https://www.w3.org/WAI/ARIA/apg/patterns/grid/>
- `prefers-reduced-motion` — <https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion>
- View Transition API (considered, rejected for board animation) — <https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API>
- Cache API / service-worker asset caching (the offline answer) — <https://developer.mozilla.org/en-US/docs/Web/API/Cache>
- Web Workers API — <https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API>
- OffscreenCanvas (v2 option: move the fx draw into the worker) — <https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas>
- Chessground — DOM board, custom DOM diff, "10K gzipped", SVG overlay; **GPL-3.0** — <https://github.com/lichess-org/chessground>
- PixiJS — <https://pixijs.com/>; bundle measured from <https://cdn.jsdelivr.net/npm/pixi.js@8/dist/pixi.min.mjs>

Search
- Expectiminimax — <https://www.chessprogramming.org/Expectiminimax>
- Star1 / Star2 pruning — <https://www.chessprogramming.org/Star1>
- Ballard, "The *-minimax search procedure for trees containing chance nodes", *Artificial Intelligence* 21(3), 1983 — <https://doi.org/10.1016/S0004-3702(83)80015-0>
- Quiescence search — <https://www.chessprogramming.org/Quiescence_Search>
- Static Exchange Evaluation (and why it does not transfer) — <https://www.chessprogramming.org/Static_Exchange_Evaluation>
- Zobrist hashing — <https://www.chessprogramming.org/Zobrist_Hashing>
- Transposition tables — <https://www.chessprogramming.org/Transposition_Table>
- Killer heuristic — <https://www.chessprogramming.org/Killer_Heuristic>; history heuristic — <https://www.chessprogramming.org/History_Heuristic>
- Principal Variation Search — <https://www.chessprogramming.org/Principal_Variation_Search>
- Late Move Reductions — <https://www.chessprogramming.org/Late_Move_Reductions>
- Null-move pruning and zugzwang (why to disable it here) — <https://www.chessprogramming.org/Null_Move_Pruning>
- Lazy evaluation — <https://www.chessprogramming.org/Lazy_Evaluation>
- UCT — <https://www.chessprogramming.org/UCT>
- Browne et al., "A Survey of Monte Carlo Tree Search Methods", IEEE TCIAIG 4(1), 2012 — <https://ieeexplore.ieee.org/document/6145622>
- Silver et al., "A general reinforcement learning algorithm that masters chess, shogi, and Go through self-play", *Science* 362, 2018 — <https://www.science.org/doi/10.1126/science.aar6404>
- Fairy-Stockfish, and its variant-configuration DSL — <https://github.com/fairy-stockfish/Fairy-Stockfish>, <https://github.com/fairy-stockfish/Fairy-Stockfish/wiki/Variant-configuration>
- Jangda, Powers, Berger, Guha, "Not So Fast: Analyzing the Performance of WebAssembly vs. Native Code", USENIX ATC 2019 — <https://www.usenix.org/conference/atc19/presentation/jangda>

Internal, treated as authoritative
- [`DIRECTION.md`](./DIRECTION.md) — visuals and 60 fps as acceptance criteria; "animation must never gate play"
- [`BRIEF.md`](./BRIEF.md) — §4 pre-decided constraints, §5 hard problems 7 and 8
- [`recon-data-substrate.md`](./recon-data-substrate.md) — §6 sprite sizes (used, not re-measured), §7 bundle discipline
- [`recon-moves.md`](./recon-moves.md) — §5 danger classes (the search's horizon-extension list), §6.5 bundle budget
- [`recon-abilities-items.md`](./recon-abilities-items.md) — §2.4 the Clash contract, §6.1 one-shot wards, §8 q5 (the TT-key warning), §7 bundle budget
- [`recon-variants.md`](./recon-variants.md) — §2.1 the 18×18 chart (independently reproduced here), §2.4 `E[Δ]` (the basis of `staticClash`), §3.2 the piece-value model (Tier-0 eval), §4 termination and sub-move counting, §5 the king-capture model, §6.3 input randomness

---

## Appendix: probe scripts and how to re-run them

| Script | What it produced |
|---|---|
| `/tmp/pcbench/bench.html` | §1.1 frame-interval table and §1.2 per-frame CPU table. Serve it (`node -e "…"` static server on :8791) and call `window.runAll()`; the second pass is the inline `browser_evaluate` block that times each tick in isolation. |
| `/tmp/pkmn-probe/tech-recon-search.mjs` | The 18×18 effectiveness census (8/61/204/51 — matches `recon-variants.md` §2.1), the branching-factor measurement (30.9 mean legal moves, 3.27 captures, 0.34 SE captures), and the naive no-TT baseline (EBF 28–42, depth 8 in 24 s). |
| `/tmp/pkmn-probe/tech-recon-search2.mjs` | The engineered searcher: flat move stack, factorised Zobrist over (square, pieceCode, **type**), TT, killers, history, quiescence following bonus chains. Produces the §2 depth/time/Mnps/EBF table. **This is the reference implementation to port into `src/ai/`.** |
| `/tmp/pkmn-probe/tech-recon-search2b.mjs` | Same, with `TT_VALUES=0` to model a near-unique key. Produces the §4.2 cost-of-state-dependence table. |
| `/tmp/pkmn-probe/tech-recon-chance.mjs` | Four randomness models (deterministic / full expectiminimax / EV-collapse / MC sample) at depths 4–8. |
| `/tmp/pkmn-probe/tech-recon-star.mjs` | Adds star1 pruning and the input-randomness model with configurable samples-per-ply. Produces the §3 table. |
| `/tmp/pkmn-probe/tech-recon-eval.mjs` | Per-term eval costs (§2): 4 ns incremental, 76 ns material scan, 194 ns `genMoves`, 470–496 ns with mobility/threats. |
| Bundle measurements | `rolldown` (already in `node_modules`) on a two-line React entry → 59,285 gz; on a Preact entry → 4,376 gz. `curl` + `gzip -c` for `pixi.min.mjs` (231,272 gz) and `chessground.min.js` (12,089 gz). `node -e` projections over the real `src/data/generated/species.json` for the §5.1 table. |

Nothing in this document required modifying the repository.
