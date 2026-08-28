# Recon: Rendering, Performance & AI Search

**Role:** rendering / performance / AI-search analyst.
**Scope:** `BRIEF.md` hard problems 7 (rendering & performance) and 8 (AI opponent); `DIRECTION.md`'s
"performance is part of looking good", "animation must never gate play", the AI that "misjudges *types*
at lower difficulties", and the new directive-4/5/6 surfaces (sandbox + headless batch simulation, a
collection/Pokédex UI, replay/spectate, the badge ladder and Gym-Leader promotion matches).

**Status: this is a second pass.** An earlier version of this document existed and its measurements are
preserved here — they are attributed as **[P1]**. New measurements from this pass are **[P2]**. Where
the two passes disagree, or where a ruling from a later recon changes the answer, §1 says so explicitly
and gives the resolution. Nothing from the first pass has been dropped silently.

**Method.** Every number is measured on this machine: in the real repo, in headless Chrome 151 via
Playwright, or in Node v24.19.0 against working prototypes. Sprite asset *sizes* are taken from
[`recon-data-substrate.md`](./recon-data-substrate.md) §6 as instructed and not re-measured; sprite
*delivery* is re-measured because §6 contains an error that a browser test catches (§A.0).
Extrapolations to slower hardware are labelled as such and carry their multiplier.

---

## 0. Executive decisions

| # | Decision | The measurement that decides it |
|---|---|---|
| **A0** | **Vendor sprites same-origin at build/deploy time. Never hotlink at runtime.** | `play.pokemonshowdown.com` sends **no `Access-Control-Allow-Origin`** — re-verified 8/8 in a real browser this pass. Consequence: canvas is permanently tainted, `getImageData`/`toDataURL` throw, WebGL `texImage2D` throws `SecurityError`, `fetch()` throws, and `<img crossorigin=anonymous>` is blocked. **[P1] found this; [P2] reproduced it.** |
| **A1** | **Hybrid: keep the DOM board and pieces; add Canvas2D effect layers.** Not pure DOM, not pure Canvas, not WebGL. | Canvas2D draws 10,000 particles in **0.84 ms/frame**; the equivalent DOM work at 4,000 elements costs **5.38 ms** — 17× per moving thing. But a full DOM board is **129 nodes** and rebuilding it from scratch costs **0.39 ms**. Use each where it wins. **[P2]**, consistent with **[P1]**'s 0.092 / 0.449 / 0.235 / 0.417 ms figures. |
| **A2** | **Extend `src/ui/App.tsx`'s board; do not replace it.** | 64 `<button>`s with real `aria-label`s and native focus already exist. Migration is **~2 days**; a canvas/Pixi rewrite is ~2 weeks and starts by re-implementing focus, hit-testing and an aria mirror. |
| **A3** | **Reject WebGL/PixiJS.** | `pixi.js@8` full browser bundle **231 KB gz [P2]** (tree-shaken to the 7 classes we'd use: **165 KB gz [P1]**) — 2.5–3.5× the entire current entry chunk — to solve a problem that measures 0.09 ms. And it *cannot* consume CDN sprites at all (A0). |
| **A4** | **The entry-chunk budget is a React budget, not an app-code budget.** | React 19 + `react-dom/client`, bundled and minified: **59.3 KB gz**. The repo's entry chunk is **65.2 KB gz**. **Our own code is 5.9 KB — 9%.** Preact core measures **4.4 KB gz**, a documented 52 KB reclaim lever. **[P2]**, agrees with **[P1]**'s 58 KB / 5.3 KB. |
| **A5** | **Do not build a board spritesheet from the 96 px stills; do use Showdown's icon sheet for grids.** | A packed 1025-sprite atlas is **2,563 KB** vs **849 KB** for the individual PNGs — 3× *worse*, because merging destroys 1025 optimal ≤16-colour palettes. **[P1]** |
| **A6** | **Virtualise the collection/Pokédex grid.** | 1367 cells plain: **65.4 ms** per build (4,102 nodes) — four dropped frames. `content-visibility:auto`: 30.9 ms. A 200-cell window: **10.5 ms**. **[P2]** |
| **B1** | **Alpha-beta negamax + PVS + quiescence, in a Web Worker. Not expectiminimax, not MCTS.** | **7.1 M nodes/sec** in plain JS with an effective branching factor of **3.8–4.2**; depth 8 in **148 ms**, depth 9 in **601 ms**, depth 10 in 2.5 s. **[P2]** — roughly 2× **[P1]**'s 3.0–3.3 Mnps, because of the TT + killers + history + quiescence stack. |
| **B2** | **Never enumerate chance nodes in the interior. Star1 is a trap.** | Full expectiminimax costs **121–159×** at depth 6 (≈4 plies). [P1] measured star1 at **1.7× worse than doing nothing**; [P2] measured it 20% *better*. Either way it is not worth implementing — see §1 and §B.3. And [P1]'s 120-game self-play match found exact interior averaging is worth **~0 Elo** (53.8% ± 4.6%). |
| **B3** | **Input randomness — the roll is public at turn start — is the single most consequential AI decision in the project.** | Measured cost over a fully deterministic search: **+10% at depth 6, +0% at depth 8**. `recon-variants.md` §6.3 already requires it on *balance* grounds. It independently makes the AI **~150× cheaper**. **[P2]** |
| **B4** | **Sample randomness at the root, never inside the tree.** | In-tree sampling multiplies: k=3 per ply costs **531×** (8.5 s at depth 6) because cost ≈ k^depth. Root averaging over R futures is linear in R. **[P2]** |
| **B5** | **Reject WASM.** | 7.1 Mnps in JS; a realistic 2× win buys `log₄(2)` = **0.5 plies**. Four cheaper changes each buy more. **[P1]** and **[P2]** agree. |
| **B6** | **Difficulty is a corrupted type chart, not a shallower search.** | **[P1]** measured the dial and it is clean and monotonic: type-error rate 5% → 47% score, 15% → 45%, 30% → 37%, 50% → 30%, 100% (type-blind) → **25%**. It never bottoms out, because a type-blind AI still plays real chess. |
| **B7** | **Gym-Leader mono-type armies need a compensating buff, and that is a feature.** | A mono-type army scores **36%** against a mixed army at equal search (40 games) — a ~14-point, ≈100–150 Elo composition handicap. **[P2]**, new requirement from `DIRECTION.md`. |
| **B8** | **Batch simulation is comfortably affordable; budget it in node-counts, not milliseconds.** | Single-threaded self-play: **66 games/s** at 500 nodes/move, **26 games/s** at 2,000, **10 games/s** at 10,000. 10,000 games at 2,000 nodes/move ≈ **6.4 min** single-threaded, ≈1 min on 8 workers. **[P2]**, new requirement from `DIRECTION.md`. |

---

## 1. Reconciliation: what changed, and what the two passes disagree about

This section exists so an implementer never has to guess which number to trust.

| Topic | First pass **[P1]** | This pass **[P2]** | Ruling |
|---|---|---|---|
| **Showdown CORS** | No ACAO ⇒ tainted canvas, WebGL throws, `fetch` throws. Vendor the sprites. | Reproduced exactly, 8/8 checks, plus: `fetch(…, {mode:'no-cors'})` *does* return an opaque response that the Cache API *will* store, but JS cannot read its body (`blob().size === 0`). | **[P1] stands and is now double-sourced.** Vendoring is mandatory. `recon-data-substrate.md` §6's "hotlinking Showdown's CDN avoids redistributing them" is **materially incomplete** — hotlinking works *only* for CSS `background-image`/`<img>`, and forecloses every pixel-level effect and any WebGL path. See §A.0. |
| **star1 pruning** | **1.7× worse** than no pruning (22.3 M vs 12.9 M nodes at depth 7, ±3000 cp bounds); structural argument: with 2–3 outcomes and loose bounds, star1 *widens* the window it passes down. | **20% better** (1,652 ms vs 1,946 ms at depth 6, ±4500 cp bounds). | **Both verdicts are "do not implement star1."** The sign of the small effect depends on the bounds and on how the child window is clamped, which is exactly [P1]'s point: the mechanism is bound-sensitive and our bounds are inherently loose (a single capture swings 950 cp; a king capture is ±29,000). [P1]'s structural explanation is the one to keep; [P2]'s +20% is within implementation noise of a partial star1. **Net: skip it, and skip star2 too.** |
| **Search throughput** | 3.0–3.3 M nps (alpha-beta + MVV-LVA); movegen 8.5 M legal-nodes/s, `perft(5) = 4,865,351` ✓ | 7.1 M nps with TT + killers + history + quiescence; `genMoves` 194 ns/position | **Both correct, different stacks.** [P1]'s `perft(5)` validation is the more valuable artefact (it proves the generator). [P2]'s 7.1 Mnps is the throughput to budget against, because the ordering stack is worth ~3 plies (measured: EBF 28–42 without it, 3.8–4.2 with it) and we will certainly ship it. **The practical effect is that the depth targets in [P1]'s difficulty table are ~2 plies conservative.** |
| **Chance-node handling** | Collapse the interior to the modal outcome + a static EV bias; expand exactly at the root only. Justified by a 120-game equal-budget self-play match showing no significant Elo difference. | `recon-variants.md` §6.3 has since ruled that the roll is **revealed before the decision**. That removes the interior chance node almost entirely: cost falls to +10%. | **Superseded, in [P2]'s favour, by a rules change neither pass authored.** Under input randomness the current turn is *fully deterministic* and there is one chance node per ply boundary, not one per capture. [P1]'s collapse+bias architecture remains the correct **fallback** for any post-commitment randomness that survives (`willCrit` moves, Quick Claw, Focus Band) — and [P1]'s finding that the *bias* term is the important half of the collapse still applies there. |
| **"The die dominates the type chart"** | [P1] risk #3: with P(crit) = P(miss) = 1/6, a third of every capture is decided by the d6, so "type knowledge is worth less than the concept implies unless the rules amplify it." | — | **Already fixed by `recon-variants.md` §6.3**, which sets γ = φ = 1/18 (so P(crit)+P(miss) = 1/9, not 1/3) and computes type knowledge at ≈10 pawns/game vs ≈1.1 pawns/game of dice noise. [P1]'s warning was correct and has been acted on. Note this **invalidates [P1]'s §B.3.2 probability table**, which bakes in 1/6 — its *ordering* (Steel best, Bug/Grass worst, Normal has zero super-effective matchups) survives and is confirmed by `recon-variants.md` §2.2. |
| **Per-type value spread** | 33% top-to-bottom (Steel 1.148 → Bug 0.864) from a P(extra)/P(mutual)/P(survive) formula. | — | **`recon-variants.md` §3.2 is authoritative** for piece values (it measures 1.46× between the best and worst type of the same class and gives α/β/ε/τ). Use that formula in the eval. [P1]'s per-type table is still useful as an independent cross-check and it agrees qualitatively. |
| **National Dex vs gen-9 view** | [P1] correction: `Generations(Dex).get(9)` is missing **292** dex numbers including Alakazam and Machamp; build from `Dex.species.all()`. | The repo's `species.json` now contains **1367 formes / 1025 base formes** — I verified it. | **Resolved; no action needed.** `recon-data-substrate.md` §1 settled the inclusion policy and `scripts/gen-data.ts` implements it. [P1]'s catch is why. |
| **Board sprite source** | Individual 96 px `gen5` PNGs for board pieces (829 KB for all 1025, 26 KB for a 32-piece game); the 40×30 icon sheet for the *draft/dex grid* only. Do not atlas the board sprites. | The repo currently uses the icon sheet for board pieces (`PokemonIcon.tsx`, offsets baked into `species.json`). | **[P1] is the better plan and is an upgrade, not a conflict.** A 40×30 icon upscaled into an 80 px square is mush; a 96 px still downscaled to 80 px with `image-rendering: pixelated` is crisp ([P1] verified visually). Keep the baked icon offsets — they are exactly right for the Pokédex/draft grid, which is now a much bigger surface than when [P1] was written (§A.8). **Ship both: stills on the board, sheet in grids.** |
| **Chain cap** | 2 extra moves (3 sub-moves/turn); costs +53% nodes over banning chains. | Used a cap of 2 extra moves as well; measured chains are *rare* (0.34 super-effective captures available per position ⇒ ~1.05 sub-moves/turn). | **Agree, and it matches `recon-variants.md` §4.2's `T1: L ≤ 3`.** The +53% is a worst case; the average cost is near zero. |
| **Difficulty ladder** | 5 levels, Rookie 150 ms → Champion 3000 ms, depths 3–9, type-error 100% → 0%, est. 800–1900 Elo. | Same shape, but depth targets rise ~2 plies at equal time given 7.1 Mnps, and `DIRECTION.md` now adds Gym-Leader mono-type armies as a *composition* lever measured at −14 points. | **Merged in §B.8.** Keep [P1]'s measured type-error dial verbatim — it is the load-bearing evidence — and add the army-composition lever. |

---

# PART A — Rendering, assets and performance

## A.0 The finding that constrains everything: Showdown sends no CORS header

Re-verified this pass in Chrome 151 against the live CDN. On the wire:

```
$ curl -sI https://play.pokemonshowdown.com/sprites/gen5/pikachu.png
HTTP/2 200
content-type: image/png
content-length: 535
access-control-allow-methods: GET,POST,OPTIONS      <-- decoy
access-control-allow-headers: Content-Type, ...     <-- decoy
cache-control: max-age=691200
                                    ...and NO access-control-allow-origin.
```

Adding an explicit `Origin:` request header changes nothing. In the browser:

| # | Operation | Result |
|---|---|---|
| 1 | plain `<img>` load | **OK 96×96** |
| 2 | `ctx.drawImage(img, …)` | **OK** |
| 3 | `ctx.getImageData(…)` after that draw | **THROW `SecurityError` ⇒ canvas permanently tainted** |
| 4 | `canvas.toDataURL()` | **THROW `SecurityError`** |
| 5 | `getContext('webgl2')` | OK |
| 6 | `gl.texImage2D(…, img)` with a non-CORS image | **THROW `SecurityError`** |
| 7 | `<img crossorigin="anonymous">` from Showdown | **FAIL — blocked, no ACAO** |
| 8 | `fetch(url)` | **THROW `TypeError: Failed to fetch`** |
| 9 | icon sheet with `crossorigin="anonymous"` | **FAIL — blocked** |
| 10 | *control:* `raw.githubusercontent.com/PokeAPI/sprites` with `crossorigin` | **OK 96×96** (`access-control-allow-origin: *`) |
| 11 | *control:* `getImageData` on the PokéAPI image | **OK — not tainted** |

And on the offline question specifically, measured this pass:

| Operation | Result |
|---|---|
| `fetch(url, {mode:'no-cors'})` | OK, `type=opaque`, `status=0` |
| `caches.put(url, opaqueResponse)` then `caches.match(url)` | **OK** — an opaque response *can* be stored |
| reading that cached body from JS (`.blob().size`) | **0** — opaque bodies are unreadable to script |
| rendering an `<img>` from an object URL built from it | **FAIL** |

So a service worker *can* cache Showdown sprites opaquely and *can* serve them back to an `<img>`
request (the browser reads the body even though script cannot) — but it is a subtle, unverifiable-from-
script path, and it still leaves the canvas tainted.

**Rulings.**

1. **"PixiJS + Showdown CDN" is impossible**, not merely inadvisable. Pixi sets `crossOrigin` on its
   loads (blocked, row 7) and `texImage2D` throws on a non-CORS image (row 6).
2. **Canvas2D + Showdown CDN is crippled.** `drawImage` works, but the canvas is tainted forever: no
   `getImageData`, no `toDataURL`. That forecloses **runtime atlas packing, type-tinting a sprite,
   silhouette/hit-flash effects, sprite-derived dissolve particles, and any screenshot/share feature.**
   Sprite-derived dissolve particles are exactly the effect `DIRECTION.md` asks for when it says
   mutual destruction must "visibly destroy both pieces".
3. **CSS `background-image` / plain `<img>` is the only thing that works untouched against the CDN** —
   which is what `PokemonIcon.tsx` does today, and why the app currently works.
4. **Vendoring same-origin unlocks all of it, and simultaneously satisfies `BRIEF.md` §4.6 (offline
   single-player).** This is the decision. It is also what `recon-data-substrate.md` §6 flags as
   needing a deliberate choice — here is the choice, with the reason.

References: [MDN, CORS-enabled image](https://developer.mozilla.org/en-US/docs/Web/HTML/CORS_enabled_image),
[MDN, `crossorigin`](https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/crossorigin).

## A.1 Measured rendering cost

Environment: Chrome 151 headless, macOS, Apple Silicon, 12 cores, `devicePixelRatio 2`, 640×640 board,
**120 Hz display** (vsync measured at 8.33 ms, not 16.67 — every frame figure below is therefore a
*tighter* test than 60 Hz).

### A.1.1 Frame intervals over 150 frames — p50 / p95 / max, ms **[P2]**

| Architecture | 0 fx | 200 | 600 | 1500 | 4000 |
|---|---|---|---|---|---|
| DOM board + per-frame `transform`/`opacity` writes from rAF | 8.3 / 9.2 / 12.5 | 8.3 / 9.3 / 16.9 | 8.3 / 9.0 / **42.1** | 8.3 / 8.9 / **91.7** | **16.7 / 33.3 / 333** |
| DOM board + CSS/WAAPI keyframes (compositor-driven) | 8.3 / 9.2 / 9.4 | 8.3 / 8.5 / 9.4 | 8.3 / 9.0 / 15.7 | 8.4 / **17.6** / **83.2** | **49.9 / 58.4 / 392** |
| Canvas2D, full redraw of board + 32 sprites + fx | 8.3 / 9.2 / 25.0 | 8.3 / 8.4 / 9.3 | 8.3 / 8.4 / 9.3 | 8.3 / 8.5 / 41.6 | **8.3 / 8.4 / 9.3** |
| **Hybrid: DOM board + Canvas2D fx layer** | 8.3 / 8.4 / 8.7 | 8.3 / 8.4 / 9.1 | 8.3 / 8.4 / 9.1 | 8.3 / 8.4 / 9.3 | **8.3 / 8.4 / 8.6** |

- Canvas2D and the hybrid stay pinned to vsync at 4,000 simultaneous effects. DOM breaks between
  1,500 and 4,000.
- **WAAPI/CSS keyframes break *earlier* than rAF style writes** at 1,500 (p95 17.6 vs 8.9). This is
  counter-intuitive and load-bearing: each independently-timed composited animation gets its own
  compositor layer, and 1,500 layers cost more than 1,500 transform writes on one layer.
  ⇒ **cap concurrent composited CSS animations at ~200; push the rest to canvas.**

### A.1.2 Per-frame CPU cost, isolated — the hardware-scalable numbers **[P2]**

| Work | 0 | 200 | 600 | 1500 | 4000 | 10000 |
|---|---|---|---|---|---|---|
| Canvas2D: `clearRect` + 64 squares + 32 `drawImage` + 32 rings + N particles | **0.027** | 0.052 | **0.102** | 0.167 | **0.352** | **0.842** |
| DOM: write `transform`+`opacity` on N elements, then force style + layout | 0 | 0.238 | **0.698** | 2.053 | **5.380** | — |
| DOM: rebuild the whole 64-square board from scratch (129 nodes + layout) | **0.392** | | | | | |

Per unit: **canvas particle ≈ 0.08 µs**, **animated DOM element ≈ 1.35 µs** — canvas is **17× cheaper
per moving thing**. But a *total* teardown-and-rebuild of the DOM board is 0.39 ms, and a targeted diff
of the ≤8 squares that actually changed is ~0.05 ms. Both facts are needed to reach the hybrid.

**[P1]**'s independent run agrees on the shape: 64 DOM pieces alone 0.092 ms; +400 DOM particles
0.449 ms; +400 canvas particles 0.235 ms; +2000 canvas particles 0.417 ms.

### A.1.3 Bundle facts, measured in the real repo **[P2]** (with **[P1]** where it went further)

| Fact | Value |
|---|---|
| DOM nodes in a full 8×8 board with 32 pieces, rings, side markers | **129** |
| Repo entry chunk `dist/assets/index-*.js` | 206,003 raw / **65,154 gz** |
| React 19 + `react-dom/client` alone, bundled + minified | 190,850 raw / **59,285 gz** |
| ⇒ the app's own code in the entry chunk | **≈ 5,900 gz (9%)** |
| Preact 10 core | 10,370 raw / **4,376 gz** |
| `pixi.js@8` full browser bundle | 819,517 raw / **231,272 gz** |
| `pixi.js@8` tree-shaken to 7 classes **[P1]** | 562 KB raw / **165 KB gz** |
| `motion@12` → `motion/mini` **[P1]** | 7 KB / **3 KB gz** |
| `@lichess-org/chessground@10` | 32,686 raw / **12,089 gz** (GPL-3.0 — see §A.2) |
| `@pkmn/img@0.3.4` at runtime **[P1]** | 41 KB gz — **avoid; bake its output at build time** |
| Repo lazy data chunks (gz) | species 76.9 · moves 77.9 · learnsets 75.6 · abilities 21.6 · items 21.9 · typechart 0.33 = **274 KB** |
| CSS | 837 raw / **521 gz** |

## A.2 The four architectures, compared and decided

**DOM + CSS transforms.** The only option that gets accessibility for free: 64 focusable `<button>`s
with `aria-label`s, native keyboard traversal, browser zoom, high-contrast mode, and a screen reader
that can read the board square by square. The
[WAI-ARIA `grid` pattern](https://www.w3.org/WAI/ARIA/apg/patterns/grid/) applies directly.
`transform`/`opacity` are the two compositor-only properties, so motion never touches layout
([MDN](https://developer.mozilla.org/en-US/docs/Web/Performance/Animation_performance_and_frame_rate)).
Zero bundle cost. It is also the only option that works against the CDN (§A.0). Lichess's own board
renderer is DOM-based — "uses a custom DOM diff algorithm to reduce DOM writes to the absolute
minimum… 10K gzipped… SVG drawing of circles, arrows"
(<https://github.com/lichess-org/chessground>). *Against:* a measured ceiling around 1,000 concurrently
animated elements, and `DIRECTION.md` asks for weather + hazards + status + a capture animation
*simultaneously*, which is a particle budget.

**Licensing note on Chessground:** it is **GPL-3.0** and this repo is Apache-2.0. Study it as an
architectural reference; do not vendor, copy or link it. Doing so would relicense the project.

**Canvas2D (everything).** Cheapest per moving thing, held 8.3 ms at 4,000 particles including
redrawing the board. *Against:* forfeits every accessibility affordance at once — no focusable squares,
no aria tree, no keyboard model, and hit-testing, focus rings, hover and tooltips all become our code.
The standard mitigation is a parallel invisible DOM mirror, at which point you maintain both. Also
tainted against the CDN (§A.0). **Rejected as the primary surface.**

**WebGL via PixiJS.** *For:* unlimited throughput, real shaders. *Against, decisively:* 165–231 KB gz
to solve a problem measuring 0.09 ms; **it cannot load CDN sprites at all** (§A.0 row 6); it adds
context-loss recovery, a texture-atlas pipeline, and a second rendering model; and it gives up the same
accessibility as canvas plus more. **Rejected.** Revisit only for a measured need for per-pixel shading
over the whole board — and then prefer one fragment shader in a bare `WebGL2RenderingContext` (~4 KB of
our own code) over a framework. [P1]'s containment argument is the right one and I keep it: the FX layer
is already behind a `Renderer` interface, so swapping Canvas2D for WebGL later touches one module.

**Hybrid: DOM board and pieces + Canvas2D effect layers ← RECOMMENDED.** Measured at 4,000 particles:
**8.3 / 8.4 / 8.6 ms** — identical to pure Canvas2D, i.e. the DOM board contributes nothing detectable.
Keeps every accessibility affordance and the 5.9 KB app bundle, and lifts the effect ceiling from
~1,000 elements to >10,000.

**Two canvases, not one:** `fx-under` (below pieces — hazards, terrain, ground shockwaves, square
auras) and `fx-over` (above — explosions, beams, debris, weather). An empty canvas costs 0.027 ms to
clear and draw, so the second is free, and it is what removes z-order ambiguity between "a piece stands
*on* Sticky Web" and "an explosion covers the piece".

## A.3 Frame-budget arithmetic

Target: **60 fps on a mid laptop and on mobile** = a 16.67 ms frame. Per
[web.dev RAIL](https://web.dev/articles/rail) and [INP](https://web.dev/articles/inp), reserve ~6 ms
for the browser's style/paint/composite/GPU work and give our JS **10 ms**.

Extrapolation factor to the target device class — **an estimate, not a measurement: 6×** (JS ~4×,
canvas fill ~6× at similar backing-store area). [P1] assumed 3–5×; I use 6× to be conservative.

Worst frame during a big capture, at 60 Hz, on a 6×-slower device:

| Line item | Measured here | ×6 | Share of 10 ms |
|---|---|---|---|
| DOM: diff and write the ≤8 changed squares + ≤32 piece transforms | ~0.05 ms | 0.30 | 3% |
| DOM: piece adornments (type ring, status chip, item glyph, vigour pips) — ≤160 composited elements, CSS-animated, **zero per-frame JS** | 0 | 0 | 0% |
| Canvas `fx-under`: hazard glyphs, terrain wash, square auras (~64 draws) | 0.03 | 0.18 | 2% |
| Canvas `fx-over`: **design ceiling 1,200 particles** + 20 beams | ~0.14 | 0.84 | 8% |
| Presenter tick: advance the timeline, update 1,200 particle states | ~0.05 | 0.30 | 3% |
| **Total** | **~0.27 ms** | **1.62 ms** | **16%** |

**Headroom 6.2×.** That is the whole argument against WebGL. Even at 120 Hz (8.33 ms frame, ~4 ms of JS
budget) on a 6×-slower device the worst frame uses 40% of the budget.

Two hard ceilings, set where the measurements bend:

- **≤ 1,200 simultaneous canvas particles.** 4,000 measured at 0.352 ms → 2.1 ms at 6× = 21% of the
  budget for one effect. 1,200 keeps any single effect under 10%. (Matches [P1]'s independently chosen
  1,500 cap; take the tighter number.)
- **≤ 250 persistent DOM nodes inside the board, ≤ 200 concurrent composited CSS animations.** We are
  at 129 nodes today; adornments and square-state glyphs take it to ~250. The 1,500-element WAAPI
  failure (p95 17.6 ms) is the empirical wall.

**Explicitly out of budget: React reconciliation during an animation.** [P1] named this as "the one
real trap" and it is. Rule: the animating layer is not React state. Pieces are React-rendered once per
*position*; their `transform` is driven imperatively between positions. Enforce with a
`useSyncExternalStore` subscription that fires only on position change, plus a lint rule banning
`useState` inside `<Piece>`.

## A.4 The existing DOM board: keep, extend, or replace?

**Verdict: extend.** `src/ui/App.tsx` already drafts from the real dex, lays pieces on real starting
squares, and resolves outcomes through the real type chart, on 129 DOM nodes with correct
`aria-label`s (`"e4: white knight, Lucario, Fighting type"`) and native focus. A rewrite discards that
for no measured gain.

Four changes, which are the whole migration:

1. **Move pieces out of the square buttons into one transform-positioned layer.** Today the sprite is a
   child of its square's `<button>`, so a move unmounts one subtree and mounts another — no animation
   is possible and React churns two subtrees. Adopt Chessground's model: one `<div class="pieces">`
   spanning the board, one absolutely-positioned element per piece **keyed by a stable piece id, not by
   square**, positioned by `transform: translate(var(--x), var(--y))`. A move becomes one custom-
   property write the compositor animates, and a capture becomes an exit animation on an element that
   still exists. Accessibility is preserved by keeping the square `<button>`s as the interactive/AT
   layer with the occupant in their `aria-label` (as now) and marking piece elements `aria-hidden`.
   *~1 day. This is the load-bearing refactor.*
2. **Extract inline styles to CSS + custom properties.** Every style in `App.tsx` is an inline object
   literal — a new object identity per render, and nothing CSS can animate. Move to classes plus
   `--type-color`, `--x`, `--y`, `--vigour`. *~0.5 day.*
3. **Add the layer stack and the two canvases.** *~0.5 day.*
4. **Insert the Presenter between engine state and the board.** *~2 days — new work, not migration.*

**Migration ≈ 2 days**, plus ~2 days for the Presenter that any architecture needs. A canvas/Pixi
rewrite is ~2 weeks and begins by re-implementing focus, hit-testing and an aria mirror.

**Keep verbatim:** `src/engine/board.ts` (its precomputed `RAYS`/`BETWEEN`/`KNIGHT_MOVES`/`KING_MOVES`/
`PAWN_ATTACKS` tables are exactly the AI's hot-path tables, and its own comment says so),
`src/engine/typechart.ts` (synchronous, statically imported — correct, and the AI depends on that),
`src/engine/rng.ts` (xoshiro128** with 4-word serialisable state — this is what makes root-level Monte
Carlo sampling and replay-by-seed possible), `src/ui/typeColors.ts` (the palette spine `DIRECTION.md`
fixes), and `src/data/dex.ts`'s `once()`-wrapped lazy chunking.

## A.5 Asset strategy

### A.5.1 Sprite economics **[P1]**, all 1025 downloaded and byte-counted

```
gen5 all base formes: 1025/1025 present, missing = 0
total 829 KB   mean 0.81 KB   p50 0.69   p95 1.24   max 10.44
32 pieces @ mean = 26 KB      64 @ mean = 52 KB
```

Every one of the 1025 exists, including Gen 9 (Showdown backfills gen-5-style art;
`gen5/koraidon.png` is a real 96×96, 1,455 B). [P1] rendered a 16-species board at 80 px with
`image-rendering: pixelated` and inspected it: crisp, period-correct, no blurry upscaling.

Other sources, 74 species sampled across the dex **[P1]**:

| Source | dims | mean | p95 | 32-piece game | whole dex | CORS |
|---|---|---|---|---|---|---|
| **`sprites/gen5/*.png`** | 96² | **0.81 KB** | 1.24 | **26 KB** | **829 KB** (exact) | none |
| `sprites/dex/*.png` | 120² | 4.2 KB | 9.7 | 134 KB | ~4.2 MB | none |
| `sprites/ani/*.gif` | ~60² anim | **61.9 KB** | 146.3 | **1.98 MB** | ~62 MB | none |
| `sprites/gen5ani/*.gif` | ~50×46 anim | 46.1 KB | 76.8 | 1.47 MB | ~46 MB | none (**27% 404**) |
| PokéAPI official artwork | 475² | 124.1 KB | 170.8 | 3.97 MB | ~124 MB | `*` |
| `pokemonicons-sheet.png` | 40×30, all formes | — | — | 0 (one sheet) | **383 KB** | none |
| `itemicons-sheet.png` | 24², all items | — | — | — | **87 KB** | none |

This sharpens `recon-data-substrate.md` §6 in one respect worth recording: animated GIFs average
**62 KB with a p95 of 146 KB** across the dex, not ~85 KB — so a 32-piece animated game is **1.98 MB
mean, up to 4.7 MB p95**.

### A.5.2 Do not atlas the board sprites **[P1]**

Real atlases built in Chromium from the 1025 PNGs:

| Packing | canvas | PNG | WebP lossless | WebP q0.8 |
|---|---|---|---|---|
| 96 px, 32 cols | 3072×3168 | **2563 KB** | 2238 | 1376 |
| 48 px downscaled | 1536×1584 | 1694 KB | 1396 | 562 |
| **1025 individual PNGs** | — | **849 KB** | — | — |

**A packed atlas is 3× larger than the individual files**, and the reason is structural, not a tuning
miss: each sprite is its own ≤16-colour indexed PNG with an optimal palette, and merging 1025 forces
one shared full-colour image. Concatenating the files gives 848,761 B and gzipping that reaches only
771 KB (9%) because PNG is already DEFLATE'd. The request-count argument dies too: **a game needs 32
sprites, not 1025** — 26 KB.

Note the atlas experiment also *required* same-origin images (`toDataURL` on a tainted canvas throws),
which is a second, independent reason vendoring comes first.

### A.5.3 Measured load time **[P1]**

Fetch a manifest, then load and paint 32 random species onto a 640×640 DOM board over a
single-threaded Python `http.server` on HTTP/1.1 — a deliberately hostile transport:

```
manifest fetch                       11 ms
32 sprites loaded + painted         105 ms from script start
first-paint 52 ms   first-contentful-paint 76 ms
32 requests, encoded bytes           32,677 B
median sprite request duration       33.2 ms
```

**Board fully populated in 105 ms.** Sprite loading needs no atlas, no preload manifest, no loading
screen.

### A.5.4 The tiering, and the offline answer

| Tier | Source | Where | Cost |
|---|---|---|---|
| 0 | **vendored `gen5` 96 px stills** | board pieces, capture close-ups | 26 KB per game (32 species); 829 KB for the whole dex on disk |
| 0 | **vendored `pokemonicons-sheet.png`** | Pokédex grid, draft grid, captured-piece tray, collection UI | 383 KB, one request, every forme |
| 0 | **vendored `itemicons-sheet.png`** | item glyphs on pieces and in the Kit picker | 87 KB |
| 0 | **CSS type pills, not `types/*.png`** | type identity everywhere | 0 KB — and accessible/colour-blind-labelled **[P1]** |
| 1 | `dex` 120 px stills | opt-in "HD" | 134 KB/game |
| 2 | `ani` GIFs | opt-in "Animated", fetched per drafted species during the draft | **1.98 MB mean, 4.7 MB p95** per game |
| 3 | PokéAPI official artwork | a single inspect/detail view | 124 KB each |

**`scripts/vendor-sprites.ts`** downloads Tier 0 into `public/sprites/` with a checksum manifest, on
the developer's or deployer's machine, concurrency 16, resuming from disk cache. `.gitignore` already
carries `public/sprites/`. `gen-data.ts` bakes `id → '/sprites/gen5/<id>.png'` and the icon-sheet
offsets (already present in `species.json`), so **`@pkmn/img` ships 0 bytes** — it stays a
devDependency, saving the 41 KB gz [P1] measured.

**Offline (BRIEF §4.6) falls out for free** once assets are same-origin: a precache service worker over
`public/sprites/` plus the app shell, and the game works cold with no network. This is the resolution of
the conflict between `BRIEF.md` §4.6 and `recon-data-substrate.md` §6.

**Animated-mode worst case, stated honestly [P1]:** ~2.0 MB, p95 4.7 MB on a cold cache. Mitigations:
fetch per drafted species during the 20–60 s draft window; a hard 6 MB per-session LRU cache ceiling;
and if the prefetch has not finished when the board mounts, render the still and hot-swap the GIF in —
so there is never a blank square.

### A.5.5 Sizing and crispness **[P1]**

- Board 640×640 ⇒ 80 px squares. A 96 px sprite in an 80 px box is a **0.833× downscale** with
  `image-rendering: pixelated` ([MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/image-rendering))
  — no blur. Verified visually.
- At DPR 2, 80 CSS px = 160 device px, so the sprite is upscaled 1.67×. With `pixelated` this reads as
  deliberate chunky pixel art. **Commit to the pixel-art look** rather than fighting it: the smooth-HD
  alternative costs 5× the bytes and looked *mushier* at 80 px in [P1]'s side-by-side.
- Sprite box 80×80, anchored bottom-centre with a 4 px lift so the Pokémon "stands" on the square.
  Let large species overflow slightly (`overflow: visible` on the board) — it reads as scale.
- Below ~44 px squares (small phones), swap the piece background to the **icon-sheet cell** (40×30),
  which is drawn for that size. One CSS class, driven by a container query.

### A.5.6 Licensing stance **[P1]**, kept in full

Measured facts: Pokémon names/sprites/art are © Nintendo / Creatures / GAME FREAK with no
redistribution licence; `smogon/pokemon-showdown-client` is AGPLv3 *for the code* and its README states
the repo "doesn't include several resource files (namely, the `/audio/` and `/sprites/` directories)";
`PokeAPI/sprites` has **no LICENSE file at all** (verified 404); the *data* we depend on
(`@pkmn/dex`, `@pkmn/data` from [pkmn/ps](https://github.com/pkmn/ps)) is MIT and safe to bake.

Four rules:

1. **No Pokémon art in git, ever.** `public/sprites/` stays gitignored. The repo stays Apache-2.0-clean:
   our code plus MIT data.
2. **`scripts/vendor-sprites.ts`** is a build-time convenience run by the developer/deployer, not
   redistribution by us.
3. **The game must be fully playable with zero Pokémon assets.** Ship a **Type Glyph mode**: each piece
   is its chess glyph on a type-coloured hexagon with the type's 2-letter code, in pure CSS/SVG. 0 KB,
   no third-party IP, contrast-checked. It is also the correct fallback for `prefers-reduced-data`, for
   offline first-run before vendoring, and for anyone forking the repo. **A first-class visual option,
   not an error state** — a designer should make it look intentional. (It doubles as the sprite-load-
   failure path, which replaces the weaker "text fallback" idea.)
4. **`ATTRIBUTION.md`** naming Nintendo/Creatures/GAME FREAK, Smogon/Pokémon Showdown, the Smogon
   Sprite Project (gen-5-style art for post-gen-5 species), pkmn/ps, with a non-commercial,
   non-affiliated statement and a takedown contact.

Not legal advice; this is the standard posture of long-lived Pokémon fan projects and the
minimum-risk option that still lets the game look good.

### A.5.7 Baked data on the critical path — and a split the repo needs **[P2]**

The generated bundles total 274 KB gz and `species.json` alone is 76.9 KB gz. A draft screen does not
need `baseStats`, `evoCondition`, `learnsetRef`, `tier` or `tags` for 1,367 formes. I built the
projection from the real file and measured it:

| Projection of the real `species.json` | Raw | **gz** |
|---|---|---|
| As shipped: 1367 formes × 29 keys | 508,302 | **76,889** |
| Tuple per entry `[num,name,types,bst,icon,abilities,formeKind]`, 1367 formes | 115,887 | **26,110** |
| Same, 1025 base formes | 78,775 | **20,529** |
| **Columnar (parallel arrays, `\|`-joined strings), 1025 base formes** | 60,651 | **17,449** |

**4.4× smaller.** ([P1] reached the same conclusion from the generator side — columnar species at
12.0 KB gz for 733 — and correctly chose **columnar JSON over a binary format**: 2 KB of savings is not
worth a custom decoder, a build-order dependency and a debugging tax. Keep it greppable.)

| Chunk | Contents | gz | When |
|---|---|---|---|
| `dex-index` | columnar 1025-base draft/collection index | **17.4 KB** | eager |
| `move-effects` | packed derived `MoveEffect` × 867 (`recon-moves.md` §6.5) | ~21 KB | eager |
| `ability-item-effects` | 310 archetype records + `shortDesc` (`recon-abilities-items.md` §7) | ~19 KB | eager |
| `typechart` | as today, statically imported | 0.33 KB | eager |
| **Critical-path total** | | **≈ 58 KB** | ✅ |
| `species-detail` | today's full `species.json` | 76.9 KB | `requestIdleCallback` or first inspect |
| `moves/items/abilities-full` | prose, full descs | 121 KB | first inspect |
| `learnsets` | 841-id union table | 75.6 KB | only behind the "Custom moveset" toggle (`recon-moves.md` §6.4) |

## A.6 Performance budgets to hold the implementation to

Every row is a CI gate. Merged from both passes; where they differed I took the tighter number.

| Budget | Target | Fail at | Measured today | Enforcement |
|---|---|---|---|---|
| **Entry chunk (JS, gz)** | ≤ 110 KB | 130 KB | **65.2 KB** (59.3 of it React) | `size-limit` per chunk in CI. Reclaim lever if breached: `preact/compat`, −52 KB measured. |
| **CSS (gz)** | ≤ 12 KB | 20 KB | 0.5 KB | same |
| **Critical-path data (gz)** | ≤ 60 KB | 80 KB | 58 KB projected (§A.5.7) | `size-limit` on `src/data/generated/*` |
| **Total bytes to first playable** | ≤ 250 KB | 300 KB | ~192 KB accounted **[P1]** | Playwright: sum `transferSize` |
| **FCP, localhost** | ≤ 300 ms | 600 ms | **76 ms [P1]** | Playwright `paint` entries |
| **Board fully painted, 32 sprites** | ≤ 500 ms | 1000 ms | **105 ms [P1]** (HTTP/1.1) | Playwright, in CI |
| **TTI, simulated Slow-4G + 4× CPU** | ≤ 1.5 s | 3.0 s | not measured | [Lighthouse CI](https://developer.chrome.com/docs/lighthouse/performance/interactive) |
| **Frame time p95 during any effect, 60 Hz mid device** | ≤ 10 ms | 16 ms | 8.4 ms p95 @4,000 particles here ⇒ ~1.6 ms of JS at 6× | Playwright replays a scripted worst frame (super-effective capture + mutual destruction + weather + 6 hazard squares) and asserts p95 |
| **Dropped frames during a capture animation** | 0 at 60 Hz | >2 | 8.6 ms max, hybrid | rAF delta histogram |
| **INP on square click** | ≤ 100 ms | 200 ms | — | `PerformanceObserver` |
| **Live canvas particles** | ≤ 1,200 | hard clamp in the pool | 4,000 measured at 0.352 ms | pool allocator caps; over-budget emitters thin out rather than drop frames |
| **Persistent DOM nodes inside the board** | ≤ 250 | 400 | **129** | test counts `board.querySelectorAll('*').length` |
| **Concurrent composited CSS animations** | ≤ 200 | 400 | — | same test |
| **Pokédex/collection grid build** | ≤ 16 ms | 40 ms | **10.5 ms** windowed / 65.4 ms unwindowed | Playwright, §A.8 |
| **JS heap after 100 moves with effects** | ≤ 60 MB **and no growth ≥5 MB over moves 50→100** | 120 MB | — | `performance.measureUserAgentSpecificMemory()` twice. **The leak gate matters more than the cap [P1]**: 500 KB/move is fine at move 10 and fatal at move 300. |
| **Engine: legal sub-move generation, one position** | ≤ 5 µs | 20 µs | **0.194 µs [P2]**; movegen 8.5 M legal-nodes/s **[P1]** | Vitest bench, fail on 20% regress |
| **Engine: perft correctness** | perft(1..5) exact | any mismatch | **perft(5) = 4,865,351 ✓ [P1]** | Vitest + `chess.js` differential test |
| **AI think time** | p50 = 0.55 × budget, **p95 ≤ 1.3 × budget**; 3 s hard cap at top difficulty; **350 ms floor** | 2× budget | depth 9 in 601 ms | Vitest bench over 200 stored positions. **p95, not p50 [P1]** — an AI averaging 400 ms that occasionally takes 6 s feels broken. |
| **AI: main-thread block from search** | **0 ms** | >16 ms | — | search only ever runs in a Worker; a lint rule forbids importing `src/ai/search.ts` from `src/ui/**` |
| **Batch sim throughput** | ≥ 20 games/s per worker at 2,000 nodes/move | <10 | **25.9 games/s [P2]** | Node bench |
| **No `@pkmn/*` in any runtime chunk** | 0 bytes | any | — | `rollup-plugin-visualizer` assertion **[P1]** |

## A.7 Effect layering, compositing and orchestration

### A.7.1 The six-layer stack — z-order by construction

Every z-index in the app is one of exactly six custom properties, declared once:

```css
:root {
  --z-board:        0;   /* 64 <button> squares: base colour, coordinates, focus ring, aria       */
  --z-square-state: 1;   /* DOM inside each button: hazard glyph, terrain tint, legal-move dot,   */
                         /*   last-move highlight, threat marker, NO-EFFECT dashed ring. <=4/square */
  --z-fx-under:     2;   /* Canvas2D: ground effects, shockwave rings, square auras, weather floor */
  --z-pieces:       3;   /* DOM: one transform-positioned element per piece, keyed by piece id     */
  --z-piece-adorn:  4;   /* DOM children of the piece: type ring, status chip, item glyph,         */
                         /*   vigour pips, ward shield, role glyph. CSS-animated, no per-frame JS  */
  --z-fx-over:      5;   /* Canvas2D: explosions, beams, debris, sparks, weather ceiling           */
  --z-hud:          6;   /* React DOM, outside the board's stacking context                        */
}
```

Rules that make z-order bugs structurally impossible:

- **No literal `z-index` anywhere else.** Lint-enforced.
- The board is one `position: relative; isolation: isolate` stacking context, so nothing inside escapes
  and nothing outside interleaves.
- Both canvases are `position:absolute; inset:0; pointer-events:none; aria-hidden:true` — they can
  never steal a click or confuse a screen reader.
- Effects choose `under` or `over` **from data** (`layer: 'under' | 'over'` on the effect archetype),
  not from code position. Hazards, terrain and Sticky Web are `under`; explosions, type flashes and
  weather particles are `over`.
- `DIRECTION.md`'s new "chess roles must be readable on the board" requirement lands on
  `--z-piece-adorn` as a small corner glyph (♟♞♝♜♛♚) on every piece — DOM, so it inherits font
  rendering, scales with zoom, and is in the aria label already.

### A.7.2 Tearing: one ticker, one write phase

- **Exactly one `requestAnimationFrame` loop in the application** (a `Ticker` singleton). Four phases
  in a fixed order every frame: `read` (geometry, once) → `simulate` (timeline + particle pools) →
  `write` (all DOM custom-property writes, batched) → `draw` (clear + paint both canvases). Reads never
  follow writes, so no forced synchronous layout.
- **The rAF loop only runs while the FX queue is non-empty [P1]** — an idle board costs zero frames.
- **A property is owned by exactly one system.** A piece's `transform` is owned by CSS via a custom
  property the ticker writes; a particle's position is owned by canvas. Never a CSS transition *and* a
  rAF write on the same property of the same element — that is the classic stutter source.
- Both canvases draw in the same `draw` phase, so they cannot present a frame apart.
- `will-change: transform` only on the ≤32 piece elements and only while a move is in flight, removed
  on completion. A permanent `will-change` on 250 elements is how you reproduce the 1,500-layer
  regression in §A.1.1.
- **The [View Transition API](https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API) is
  rejected for board animation** — it snapshots the whole document and serialises, which is exactly the
  "animation gates play" failure `DIRECTION.md` forbids. Fine for screen-level transitions
  (draft → match, collection → Pokédex).

### A.7.3 Decoupling: the engine never waits, and never knows the UI exists

```
engine (pure, no DOM)                presenter (owns time)             renderer
─────────────────────                ─────────────────────             ────────
apply(state, action)
  -> { state', events: EffectEvent[] } ──▶ ingest(events)               ──▶ DOM writes
                                            lay Cue[] on a beat grid    ──▶ canvas draws
authoritative state advances                interpolate displayed state
INSTANTLY. Nothing awaits.                  accept input at any time
```

- `EffectEvent` is **pure serialisable data** in the replay log:
  `{ seq, kind, actors: Square[], payload }`. No timing, no colours, no DOM references. Because it is
  in the log, a replay reproduces the *animation* too — and a spectator or a reconnecting client can
  render a move it never computed. That is directly load-bearing for `DIRECTION.md`'s new multiplayer
  requirements (spectating, reconnect-by-replay).
- The presenter holds `authoritative` (always current) and `displayed` (derived, lagging). Every visual
  is a pure function of `displayed`, which is what makes skipping safe: `settle()` sets
  `displayed = authoritative` and jumps every in-flight cue to its end pose.
- **Input is never gated.** `onSquareClick` calls `presenter.settle()` then dispatches. Click during an
  explosion and the explosion completes instantly and the move is accepted. Nothing `await`s an
  animation.
- The AI's reply is computed in the Worker *while* the animation plays, so animation time is free
  latency. At mid difficulty (≤1 s) and a ~900 ms capture animation, the AI's move is usually ready
  before the player finishes watching theirs.
- `FxQueue` is **pure and deterministic [P1]**: a Vitest test can assert "a super-effective capture with
  seed 7 emits exactly 240 particles with these initial velocities". That is the only way FX code stays
  testable.

### A.7.4 The beat grid, and the five verdicts

Free-form scheduling is where "many simultaneous effects" becomes an ordering bug. Every action's cues
are laid on a fixed **beat grid**, so two effects can never race. Total capture resolution is budgeted
at **≤700 ms** at Normal speed **[P1]** — longer and it stops feeling like chess.

| Beat | ms (Normal) | Layer | What plays |
|---|---|---|---|
| 0 `INTENT` | 0 | DOM | attacker scales to 1.08; target square gains a `.sq--targeted` ring |
| 1 `MOVE` | 0–140 | DOM | attacker `translate3d` to target, `cubic-bezier(.34,1.4,.64,1)` overshoot |
| 2 `CLASH` | 140–320 | Canvas | the **outcome reveal**. Under input randomness the roll is *already public*, so this is a confirmation beat, not a suspense beat — see the note below |
| 3 `VERDICT` | 320–520 | Canvas | outcome-specific, table below |
| 4 `AFTERMATH` | 520–620 | Canvas+DOM | ward pop (a shield cracking), thorns recoil, status applied, item consumed, hazard triggered, drain, Vigour pip change |
| 5 `GRANT` | 620–700 | DOM | **the bonus move.** Board dims 25%; the granted piece gets a persistent pulsing type-coloured aura; a "+1 MOVE" chevron banner slides in; legal targets light up. The aura persists until the sub-move is played |
| 6 `AMBIENT` | ∞ | Canvas+DOM | weather particles, terrain wash, idle bob, trapped-piece chains, aura rings |

**Verdict visuals — colour is redundant, never primary [P1].** Each outcome has distinct *motion*,
distinct *sound*, and distinct *text*, so a colour-blind player, a muted player and a player who
blinked all still get it.

| Outcome | Colour | Drawn | Sound | Words |
|---|---|---|---|---|
| **Super effective** (≥2×, or crit) | attacker's type colour, gold rim for crit | radial shockwave 0→96 px + 240 burst particles + the attacking type's glyph stamped at 2× then shrinking | rising two-note sting | **"SUPER EFFECTIVE"** / **"CRITICAL HIT!"**, 180 ms punch-in |
| **Not very effective** (0.5×) | desaturated slate | both sprites crack: two grey shatter fans of 90 particles each, drifting **apart** | dull descending thud | **"NOT VERY EFFECTIVE — BOTH FALL"** |
| **Miss** (the retained 1/18 flinch) | red | a red X in two 6 px strokes, 120 particles falling under gravity | descending buzz | **"MISS"** |
| **No effect** (0×) — *never animates* | — | the move is **not generated**; on piece selection the square already shows a dashed grey ring + `NO EFFECT` tooltip. Clicking it plays a 60 ms shake with no state change | soft "nope" click | tooltip only |
| **Neutral** (1×) | neutral white | 60-particle puff, no shockwave, target fades over 120 ms | short click | none |

Two rules that carry most of the legibility:

- **Immunity gets pre-emptive feedback, not post-hoc [P1].** The single worst legibility failure in the
  original rules is discovering mid-attempt that Ground cannot take Flying. The legal-move list already
  knows, so illegal-by-type squares render with a distinct dashed affordance **from the moment you pick
  the piece up. Nothing about immunity is ever a surprise.** Only 8 of 324 ordered pairs are 0×, so the
  affordance is rare enough to feel special and common enough to matter.
- **Text is DOM, not canvas [P1].** The verdict banner is a real `aria-live="assertive"` element
  ("Super effective. Charizard captures Venusaur. Extra move."). The canvas is `aria-hidden` and carries
  **zero** information that is not also in the DOM. Every beat also writes to an `aria-live="polite"`
  log — the accessibility path and the "legibility under load" path are the same path, and it is free.

**Chains stack, they don't replay [P1].** A 2-extra-move chain does not play 700 ms three times: links
2 and 3 skip `INTENT` and compress to 420 ms, and the "+1 MOVE" banner increments rather than
re-animating. With the cap at 3 sub-moves the worst case is **700 + 420 + 420 = 1,540 ms**.

**Note on the `CLASH` beat, changed by input randomness.** [P1] specified a d6 tumble as the suspense
beat, which was correct under post-commitment rolls. Under `recon-variants.md` §6.3 the roll is public
*before* the player commits, so suspense has already been spent — and dramatising a known outcome is
padding. Replace the tumble with a **turn-start reveal**: at the top of each turn, the CRIT type and
FLINCH type are stamped onto the HUD with one 300 ms animation, and every affected piece's aura changes
colour. That is one animation per turn instead of one per capture, it is *more* legible, and it is
strictly cheaper.

### A.7.5 Speed modes and reduced motion

A single `animationSpeed` in the store, read by both the DOM controller and the FX loop — an explicit
per-beat duration table, **not** a global CSS multiplier **[P1]**.

| Mode | Capture total | Piece slide | Particles | Notes |
|---|---|---|---|---|
| **Cinematic** | 1000 ms | 200 ms | 1200 | default for the first 3 games, then offer to speed up |
| **Normal** (default) | 700 ms | 140 ms | 1200 | the table above |
| **Fast** | 260 ms | 80 ms | 300 | verdict text + one 100 ms flash. **Not "Normal but shorter"** — it removes the theatre and keeps the information, which is what a player on their 200th game wants |
| **Instant** | 0 ms | 0 ms | 0 | position snaps; the verdict appears in the move list and the `aria-live` region only |

Holding <kbd>Shift</kbd> while committing plays that one move at Instant speed **[P1]**.

**Reduced motion is not Instant [P1]** — Instant destroys the feedback loop.
`@media (prefers-reduced-motion: reduce)` and a manual toggle (OS preference is coarse) produce:

| Removed | Kept |
|---|---|
| all particles (the canvas rAF loop never starts) | verdict banner, held **900 ms** instead of 400 |
| screen shake, board glow, overshoot easing | a 2 px static outline pulse — one step, not a loop |
| piece slide | a 160 ms cross-fade, so the eye can follow which piece moved |
| chain replays | "+1 MOVE" as static text |

Implementation: `matchMedia` sets a store flag; the renderer short-circuits to a `StaticRenderer` that
draws nothing and the DOM controller uses `reducedDurations`. **Test it:** a Vitest case asserting
`FxQueue.enqueue()` produces zero draw calls when the flag is set, plus one Playwright run with the
media feature emulated. And a test that the game is *completable* at `beatScale = 0`.

### A.7.6 Particle pools, so effects cannot allocate

One pre-allocated struct-of-arrays pool at the 1,200 budget:

```ts
// 1200 x 9 float32 = 43 KB, allocated once, never grown.
const px, py, vx, vy, life, maxLife, size: Float32Array;  // 1200 each
const tint: Uint8Array;   // index into the 18 type colours
const layer: Uint8Array;  // 0 = fx-under, 1 = fx-over
let liveCount = 0;        // pool is compacted, so the draw loop is contiguous
```

Emitters request `n` and get `min(n, remaining)`. **Over-budget degrades gracefully**: a denied emitter
reduces density but keeps its silhouette, so the frame never drops. Zero per-frame allocation means zero
GC pauses — which is what removes the 42–333 ms `max` spikes in the DOM rows of §A.1.1.

## A.8 The new surfaces from directives 4–6

`DIRECTION.md` now requires a collection, a Pokédex worth completing, a sandbox with batch simulation,
replay/spectating, and a badge ladder. Three of those have rendering consequences.

### A.8.1 The Pokédex / collection grid must be virtualised **[P2]**

Measured: a grid of cells each with an icon-sheet sprite, a name and a border.

| Variant | ms per build | DOM nodes |
|---|---|---|
| 1367 cells, plain | **65.44** | 4,102 |
| 1367 cells, `content-visibility:auto` + `contain-intrinsic-size` | **30.86** | 4,102 |
| **200-cell window (virtualised)** | **10.52** | **601** |

65 ms is four dropped frames and a visible hitch on the most-visited screen in the meta-game.
**Ruling: window the list to ~200 cells and additionally set `content-visibility: auto` on cells**
(belt and braces, and it makes the non-windowed fallback survivable). The icon sheet means all 1367
sprites cost **one** request regardless (§A.5.4), so the *bytes* are already solved — this is purely a
DOM-count problem. `--z-*` discipline does not apply here; the grid is HUD-layer.

### A.8.2 Replay, spectate and reconnect are free if the Presenter is honest

Because the engine emits `EffectEvent[]` as data and a whole game serialises to a seed plus an action
list, replay/spectate/reconnect all reduce to "feed the presenter an action list, optionally with
`beatScale` turned down". No second rendering path. The one requirement this places on the Presenter:
**`ingest()` must be idempotent under fast-forward**, i.e. replaying 60 actions at `beatScale = 0` must
land on exactly the state that 60 individual `apply` calls produce. Assert it in a test.

### A.8.3 The sandbox's batch simulation is a Worker-pool problem, not a rendering one

See §B.7.4. The only UI surface is a progress bar and a results table; run `navigator.hardwareConcurrency
- 1` workers and stream aggregate counters back, never per-game state.

## A.9 File layout for the rendering half **[P1]**, with the second-pass additions marked

```
src/
  ui/
    board/
      Board.tsx            # 64 <button class=sq>, React, renders once per position
      Pieces.tsx           # [P2] ONE container; one transform-positioned element per piece id
      Piece.tsx            # one div, background-image, no state
      squares.ts           # square <-> pixel math, single source of truth
      layers.css           # [P2] the six --z-* custom properties, and nothing else may set z-index
      Board.module.css
    fx/
      Ticker.ts            # [P2] the ONE rAF loop: read -> simulate -> write -> draw
      FxQueue.ts           # pure: enqueue(FxEvent) -> deterministic particle emissions
      Renderer.ts          # interface { draw(dt): void }   <-- swap point for a future WebGL layer
      Canvas2DRenderer.ts  # the one implementation; two contexts (under, over)
      StaticRenderer.ts    # prefers-reduced-motion: draws nothing
      particles.ts         # struct-of-arrays pool, cap 1200
      effects/             # superEffective.ts, mutual.ts, miss.ts, neutral.ts, rejected.ts
    present/
      Presenter.ts         # [P2] authoritative vs displayed state; settle(); beat grid
      beats.ts             # [P2] the beat table x speed mode x reduced motion
    dex/
      DexGrid.tsx          # [P2] virtualised 200-cell window over 1367 formes
    sprites/
      spriteUrl.ts         # generated: id -> '/sprites/gen5/<id>.png'  (baked, no @pkmn/img)
      iconOffsets.ts       # generated: id -> [left, top] into pokemonicons-sheet.png
      glyphMode.ts         # Type Glyph fallback renderer, 0 assets
scripts/
  vendor-sprites.ts        # downloads 829 KB + 383 KB + 87 KB into public/sprites/, checksummed
  gen-data.ts              # exists; extend to emit spriteUrl + the thin dex-index chunk
public/
  sprites/                 # GITIGNORED. never committed.
```

---

# PART B — The AI opponent

## B.1 Why no off-the-shelf engine, and what survives

### B.1.1 Stockfish **[P1]**

Every layer assumes the rules of chess as a compile-time constant.

1. **Bitboards.** Move generation is magic bitboards over `U64` masks for exactly 64 squares and 6
   piece types. There is no bitboard formulation of "this rook may not capture that bishop because
   Ground cannot hit Flying" — legality depends on the *pair*, which is not a per-piece attack mask.
2. **NNUE.** Input features are (king square × piece × square) tuples. A Pokémon's type, status,
   Vigour and item are not in the input space. Retraining is not configuration; it is generating
   billions of self-play positions for a game whose rules are still settling.
3. **Determinism.** `makeMove` is assumed to be a function; ours is a distribution.
4. **UCI cannot express our position.** FEN has 12 piece symbols and six fields; there is no field for
   18 types × abilities × items × Vigour × status × charges, and none for "it is still my turn because
   I got a free move" ([CPW: UCI](https://www.chessprogramming.org/UCI)).

**Could we use it for "pure chess" sub-positions? No, and the reason is worth stating because it looks
tempting [P1].** A sub-position is only pure chess if no capture will ever be type-affected — but every
piece carries a type permanently, so *every* capture in *every* line is type-gated. There is no subtree
of this game that is standard chess. Even a pawn-storm endgame with no capture available is impure:
Stockfish would price the promotion race with standard piece values, while a Bug-type queen is worth
~0.86× and a Steel-type queen ~1.15× (and `recon-variants.md` §3.2 measures a 1.46× spread), and a
Ghost king may be uncapturable by half the enemy army. Its answers would be confidently wrong in
exactly the positions where type knowledge is supposed to decide the game.

The narrow legitimate use: an **offline development sanity-check** on deliberately type-neutral
positions (all 32 pieces one type ⇒ every capture 1×). That is a test harness, not a feature, and
`chess.js` already covers legality more cheaply.

### B.1.2 Fairy-Stockfish — the strongest candidate, and it still fails **[P1]**

`variants.ini` is a **fixed declarative parameter list**, not a scripting language
([wiki](https://github.com/fairy-stockfish/Fairy-Stockfish/wiki/Variant-configuration)). It exposes
piece definitions (Betza notation), board geometry, `startFen`, pawn step regions, castling, promotion,
drops/pockets, `mustCapture`, `checking`, and win conditions.

| Our mechanic | Expressible? |
|---|---|
| d6 randomness on capture | **No.** Every option is deterministic; there is no chance-node machinery in the search at all. |
| Mutual destruction | **No.** Nothing parameterises capture *resolution*. Atomic's explosion is hard-coded C++. |
| Super-effective ⇒ extra move | **No.** Turn alternation is not parameterised. |
| Capture legality depends on the (attacker, defender) **pair** | **No.** Betza notation restricts what a piece captures *like*, and regions restrict *where* — never *which enemy*. |
| One-shot wards (state-dependent legality) | **No.** No per-piece mutable attributes. |

Encoding 18 types as 108 piece types is theoretically possible and practically hopeless: piece-value
tables, NNUE input and move generation all scale with piece-type count, and it still cannot express the
ward. A C++ fork needs a new chance-node search, a new evaluation and a new position representation —
i.e. the whole engine — while inheriting 100k lines of chess assumptions, an Emscripten toolchain
whose threaded build needs `SharedArrayBuffer` and therefore COOP/COEP headers (breaking plain static
hosting: [stockfish.wasm](https://github.com/lichess-org/stockfish.wasm)), and a **GPL licence that
conflicts with this repo's Apache-2.0**.

### B.1.3 Three search invariants that are actually false in this variant **[P2]**

Worth calling out separately, because they are the bugs a competent chess programmer would write.

- **Null-move pruning** (<https://www.chessprogramming.org/Null_Move_Pruning>) assumes having the move
  is an advantage. Under mutual destruction, *being forced to act* is often bad — a piece with 0.5×
  matchups against everything nearby would rather stand still — so zugzwang-like positions are common
  rather than rare. **Disable null-move pruning in v1**; re-enable only behind a measured self-play A/B.
- **Static Exchange Evaluation** (<https://www.chessprogramming.org/Static_Exchange_Evaluation>) assumes
  an exchange resolves by comparing values down a recapture chain. Under mutual destruction the attacker
  can die whether or not there is a recapture, so classical SEE has the **wrong sign** on a large class
  of moves. Replace it — §B.6.2.
- **"In check" is not a search concept** under king-capture (`recon-variants.md` §5, R1–R2). Check
  extensions, check-evasion generation and `isCheckmate()` all disappear, replaced by "the enemy king is
  capturable", which is cheap and terminal.

### B.1.4 What is salvageable — most of the engineering

Everything about *managing a tree*; nothing about *chess semantics*.

| Salvageable | Status |
|---|---|
| Iterative deepening + aspiration windows ([CPW](https://www.chessprogramming.org/Iterative_Deepening)) | **[P2] measured working**, EBF 3.8–4.2 |
| Zobrist hashing ([CPW](https://www.chessprogramming.org/Zobrist_Hashing)) — needs a **factorised** key (§B.5) | **[P2] measured working** |
| Transposition table ([CPW](https://www.chessprogramming.org/Transposition_Table)) — value cutoffs weaken (§B.5) | **[P2] measured**: losing them costs ~1 ply |
| Killer + history heuristics, PVS ([CPW](https://www.chessprogramming.org/Principal_Variation_Search)) | recommended; worth ~3 plies with the TT |
| Quiescence ([CPW](https://www.chessprogramming.org/Quiescence_Search)) — needs a variant "unstable" predicate (§B.6.3) | **[P2] measured working** |
| MVV-LVA — but keyed on the outcome-aware clash value, not raw victim value (§B.6.2) | recommended |
| Late move reductions ([CPW](https://www.chessprogramming.org/Late_Move_Reductions)) | v2 |
| Lazy evaluation ([CPW](https://www.chessprogramming.org/Lazy_Evaluation)) — **critical here**, the good terms cost 6.5× | recommended |
| Repetition via the hash — must count **sub-moves**, and must **exclude the RNG counter** | required |
| `chess.js@1.4.0` as a test oracle (already a devDependency) | required |
| 0x88 / mailbox representation and `src/engine/board.ts`'s precomputed tables | **[P1] validated: `perft(5) = 4,865,351` ✓ at 8.5 M legal-nodes/s** |
| **Not salvageable** | NNUE, opening books, endgame tablebases, null-move pruning, classical SEE |

## B.2 What was measured **[P2]**

A working variant searcher in Node (V8 — the same engine a Worker runs) with real variant rules: the
true 18×18 table from `@pkmn/data`, type-illegal captures excluded from generation, mutual destruction
on 0.5×, bonus sub-moves on 2× capped at 3 sub-moves per turn, king capture terminal.

The effectiveness census independently reproduces `recon-variants.md` §2.1 exactly:
**8 illegal / 61 mutual-destruction / 204 neutral / 51 super-effective** of 324 ordered pairs.

**Branching factor**, 120 plies of random play from a randomly-typed start:

| Quantity | Measured |
|---|---|
| Mean legal moves per position | **30.9** (max 46) |
| Mean captures available | **3.27** |
| Mean **super-effective** captures available | **0.34** |

Two consequences. (a) Our branching factor is essentially chess's (~31 vs ~35 — the 8 illegal pairs
shave a little), which puts us in alpha-beta's home territory, not MCTS's. (b) **Bonus chains are
rare** — 0.34 SE captures per position ⇒ ~1.05 sub-moves per turn — so extra moves cost the search
almost nothing on average while being the game's headline mechanic. ([P1] measured the *worst* case from
the other direction: cap 2 costs +53% over banning chains.)

**Search throughput**, iterative deepening with TT + killers + history + quiescence:

| Depth | Nodes | Time | Mnps | EBF | TT hit% |
|---|---|---|---|---|---|
| 6 | 71,771 | **11.4 ms** | 6.30 | 2.99 | 25.7 |
| 7 | 278,190 | **38.9 ms** | 7.15 | 3.88 | 24.2 |
| 8 | 1,056,245 | **148 ms** | 7.12 | 3.80 | 25.6 |
| 9 | 4,192,983 | **577 ms** | 7.27 | 3.97 | 26.8 |
| 10 | 17,540,249 | **2,460 ms** | 7.13 | 4.18 | 29.2 |
| 11 | 90,022,411 | 12,985 ms | 6.93 | 5.13 | 30.8 |

**7.1 M nodes/sec in plain JavaScript, EBF ≈ 4.** For calibration, the same searcher without TT,
killers or history had **EBF 28–42** and took 24 s to reach depth 8. The ordering machinery is worth
~3 plies and all of it transfers from chess unchanged.

**Cost of each eval term:**

| Operation | ns/call | vs material eval |
|---|---|---|
| Read an incrementally-maintained material accumulator | **4** | 0.05× |
| Material eval, 64-square scan with a type-aware value table | **76** | 1.00× |
| `genMoves`, one side, full board | **194** | 2.55× |
| Material + **mobility** (both sides' move counts) | **470** | **6.17×** |
| Material + **super-effective-threat scan** | **496** | **6.50×** |

Implied nps if a node costs one `genMoves` plus one eval: 5.05 (incremental) / 3.70 (material scan) /
**1.51 (mobility)** / 1.45 (threats). Naively adding the good terms at every leaf costs **2.4×** ≈
1.25 plies. §B.6.1 says what to do.

## B.3 Chance nodes: the measured answer, and the rules change that resolves it

Same position, same searcher, five randomness models:

| Model | d5 | d6 | d7 | d8 | vs deterministic @d6 |
|---|---|---|---|---|---|
| **Deterministic** (type chart only) | 4.0 ms | **16.1 ms** | 97 ms | 610 ms | **1.0×** |
| Full expectiminimax, 3-way chance node per capture (MISS ⅙ / CRIT ⅙ / TYPE ⅔) | 106 ms | **1,946 ms** | — | — | **121×** |
| …**+ star1**, ±4500 cp bounds | 70 ms | **1,652 ms** | 15,741 ms | — | **103×** |
| **Input randomness** (public per-turn CRIT/FLINCH type), 1 sample per ply | 5.7 ms | **20.6 ms** | 100 ms | 604 ms | **1.28×** |
| Input randomness, **3 samples per ply** | 732 ms | **8,544 ms** | — | — | **531×** |
| EV-collapse of a post-commitment d6 (one child + static correction) | 7.7 ms | 26.7 ms | 470 ms | 2,026 ms | **1.66×** |

[P1]'s independent prototype found the same shape from the other end: sound full-window expectiminimax
reached **187 M nodes / 65 s at depth 5** from a middlegame position, while collapsed search cost
**43 k / 34 ms — the same as plain chess**.

**(a) Full enumeration is unaffordable.** ~100–160× at depth 6 ≈ **4 plies**. A depth-9 engine becomes a
depth-5 engine, and depth 5 does not see a two-capture combination through a bonus move.

**(b) Star1 is not the rescue, and [P1]'s explanation is the one to keep.** Ballard's *-minimax
(<https://www.chessprogramming.org/Star1>; Ballard 1983, *Artificial Intelligence* 21(3):327–350;
Hauk, Buro & Schaeffer, *Rediscovering \*-Minimax Search*, CG 2006,
[Springer](https://link.springer.com/chapter/10.1007/11922155_3)) recovers bounds at a chance node using
static `[L,U]` bounds on any child:
`A_i = (α − Σ_{j<i} p_j v_j − U·Σ_{j>i} p_j) / p_i`. Its power is entirely in how tight `L,U` are. Two of
our properties break it:

1. **`n` is tiny** — 2 or 3 children, never backgammon's 21. Star1's win comes from cutting child 3 of
   21; with 3 children the best case is skipping one.
2. **`U − L` is huge relative to `β − α`.** A single capture swings 950 cp and a king capture is
   ±29,000, so honest bounds are wide. Substituting `n=3, U=+3000, L=−3000` yields a child window
   *wider than* `[α, β]` — so star1 does not merely fail to cut, it **widens the window it passes down**
   and destroys ordinary alpha-beta inside each child. [P1] measured exactly that: **1.7× worse**
   (22.3 M vs 12.9 M nodes at depth 7). [P2], with different bounds and a partial implementation,
   measured a 20% *gain* — which is the same story: the effect is bound-sensitive and small in both
   directions. **Do not implement star1 or star2.** This is the most expensive wrong turn available in
   this project and it is the one the literature invites.

**(c) Input randomness is the answer, and it costs 10–28%.** `recon-variants.md` §6.3 requires the
turn's random state be revealed publicly at turn start ("a CRIT type… and a FLINCH type… Both players
see both") on *balance* grounds. **It is independently the right AI decision, by two orders of
magnitude.** With the roll public at the start of a turn:

- The **root has no chance node at all** — the current turn's randomness is resolved and known, so the
  search over the current turn is fully deterministic.
- There is **one chance node per ply boundary** (the opponent's future roll), not one per capture — and
  captures average 3.27 per position, so that alone is a ~3× reduction before any other trick.
- Sampling one future roll per ply costs **+28% at depth 6 and +0% at depth 8** (604 vs 610 ms — inside
  noise).

**This is the single most consequential finding in Part B: the ruleset choice that makes the game fairer
is the same choice that makes the AI ~100× cheaper.** If the design reverts to post-commitment rolls,
the AI loses ~4 plies and the difficulty ladder drops roughly 400 Elo. It also, as [P1] noted for a
different reason, keeps the **transposition table sound** — sampled interior chance nodes would poison
it with stale samples and break the `BRIEF`'s determinism requirement.

**(d) Sample at the root, never in the tree.** In-tree sampling costs ≈ k^depth: k=3 measured at
**531×**. The correct structure:

```
bestMove(state, budgetMs, R):
  futures = [ rngFork(state.rng, i) for i in 0..R-1 ]   # R seeded sampled futures
  for i in 0..R-1:                                       # COMMON RANDOM NUMBERS:
      # every root move is evaluated against the SAME future i, so the comparison is paired
      run one full iterative-deepening search with futures[i] driving every chance node
      accumulate each root move's score
  return argmax(mean score)
```

Cost is **linear in R**, and common random numbers remove most of the sampling variance because the
comparison is paired. Measured: R=6 at depth 8 ≈ 3.6 s; R=6 at depth 7 ≈ **0.7 s**; R=4 at depth 8 ≈
2.4 s. `src/engine/rng.ts`'s 4-word serialisable state makes `rngFork` a pure function, so every sampled
future is reproducible in a replay.

**(e) For whatever post-commitment randomness survives** — `willCrit` moves, Quick Claw's 20%, Focus
Band's 1-in-6 — use **[P1]**'s collapse: resolve the modal outcome and add a static probability
correction. [P1]'s key finding here still stands and is the important half: naive modal collapse
systematically **over-values captures** (it assumes the good branch and never pays for the miss —
scoring a midgame position at +1012 where sound search said +1906), and adding
`bias = Σ P(o)·Δmaterial(o) − Δmaterial(modal)` fixes it for one multiply-add and zero extra nodes.
[P2] measured the collapse at 1.66× ≈ 0.4 plies.

**(f) [P1]'s self-play evidence that interior exactness is worth ~0 Elo.** An equal-node-budget match
between a sound-interior agent and a collapsed-interior agent, both exact at the root, over 120 games:

```
40,000 nodes/move,  80 games:  collapsed 37 – 25 sound, 18 draws  -> 57%   (avg 93 plies)
150,000 nodes/move, 40 games:  collapsed 14 – 17 sound,  9 draws  -> 46%   (avg 96 plies)
pooled, 120 games:                                collapsed 53.8% ± 4.6%
```

Not significant. **Exact interior chance-node averaging buys no strength and costs 100–4000× the
nodes.** This is the strongest single piece of evidence in either pass and it is why (a)–(e) are safe.

### B.3.1 Why not MCTS/UCT, and why not flat Monte Carlo

MCTS ([CPW](https://www.chessprogramming.org/Monte-Carlo_Tree_Search),
[CPW: UCT](https://www.chessprogramming.org/UCT); Browne et al., *A Survey of Monte Carlo Tree Search
Methods*, IEEE TCIAIG 2012, <https://ieeexplore.ieee.org/document/6145622>) is genuinely attractive on
paper — chance nodes are free, chains are just longer rollouts — and it loses for four concrete reasons:

1. **Branching factor 30.9, measured.** MCTS's edge grows with branching (Go: 250). At 31 with EBF 4
   after ordering, alpha-beta reaches depth 9–10 in a second.
2. **We have a good static evaluation.** `recon-variants.md` §3.2 hands us a derived, principled
   type-aware value formula with precomputable 18×18 tables — exactly the asset alpha-beta monetises and
   MCTS wastes.
3. **Random rollouts are worthless here**, and worse than in chess: in a mutual-destruction game random
   play annihilates both armies in a few dozen plies, so a rollout's terminal value carries almost no
   information about the root. Fixing it needs a learned policy/value net
   (AlphaZero, <https://www.science.org/doi/10.1126/science.aar6404>) — a self-play pipeline and GPU
   training we do not have, and which would not fit in a 110 KB bundle.
4. **Tactics are sharp.** A single missed super-effective capture chain can be losing, and UCT's
   averaging notoriously under-weights narrow refutations.

**Where MCTS *is* right, and we should use it there: the draft, and the Chess18 pairing screen.**
Drafting is a 32-pick sequential game with a combinatorial action space, no useful notion of depth, and
a value that only exists at the end (the pairing's win probability). That is textbook UCT, and
`recon-variants.md` §1.6's "engine-evaluate candidate pairings, publish the eval, ban or handicap the
tails" is exactly a rollout procedure. It is now *also* the natural engine for the new
collection/deck-building layer. Budget it as a v2 offline tool driven by the batch simulator (§B.7.4),
not an in-game search.

**Flat Monte Carlo** is rejected: with EBF 4 and 7 Mnps, alpha-beta sees a forced 4-move combination in
11 ms; flat MC never sees it at any budget. Its one virtue **[P1]** is as a *baseline opponent for
measuring* our real AI's strength — 40 lines, and a fixed rung to calibrate the ladder against.

## B.4 What a "ply" is, and why the game terminates

`recon-variants.md` §4.1 proves the chain bound (`L ≤ 1 + N ≤ 17`) and §4.2 ships `T1: L ≤ 3`. The
search consequence is that **the side to move does not alternate at every node**. Carry
`(sideToMove, chainLeft, bonusPieceMask)` and, on a bonus sub-move, recurse **without negating**:

```ts
if (isCapture && eff === SUPER && chainLeft > 0 && !bonusPieceMask.has(from)) {
  score = search(state, side, depth - 1, alpha, beta, chainLeft - 1, bonusPieceMask | bit(to));
} else {
  score = -search(state, -side, depth - 1, -beta, -alpha, /*chainLeft*/ 2, /*mask*/ 0);
}
```

This is the correct formulation because depth measures *decisions*, and an extra move is a decision.
Four knock-on effects, each a bug if missed:

1. **Depth is measured in sub-moves.** At ~1.05 sub-moves per turn, nominal depth 9 ≈ 8.6 turns. Do not
   label it "moves ahead" in the UI.
2. **Mate-distance scores must be `29000 − subMoveCount`**, not `− ply`, or the engine prefers a slower
   king capture.
3. **Progress and repetition counters count sub-moves**, matching `recon-variants.md` §4.3's "100
   consecutive **sub-moves**". A turn-based counter under-counts and is not monotonic across a chain.
4. **`T3` (exposing the enemy king ends your turn) needs a cheap test after every sub-move.** Do **not**
   run a full opponent `genMoves` (194 ns × every sub-move). Run `isAttacked(enemyKingSquare, bySide)`:
   an 8-ray walk plus the knight ring plus the pawn-attack table — all already precomputed in
   `src/engine/board.ts`. ~30 lookups, ≈15 ns. It must respect type legality (a Ground piece does not
   "expose" a Flying king), so it is `attackersOf(sq)` filtered by `EFF[atkType][kingType] !== 0`.

`bonusPieceMask` implements `recon-variants.md`'s `T2` (one bonus per piece per turn), and the cap of 3
sub-moves bounds the animation at **1,540 ms [P1]** as well as the search.

**One rules recommendation from the AI side: make the bonus sub-move optional** — generate an explicit
`DeclineBonus` action at bonus nodes. Reasons: (i) a mandatory extra move can *force* a player into a
self-harming capture, an undesigned zugzwang mechanic players will report as a bug; (ii) the search needs
the decline branch to evaluate chains honestly; (iii) it is one line in move generation and removes a
class of degenerate lines. Consistent with Marseillais, where the *count* of moves is fixed but each is
chosen freely.

## B.5 State-dependent legality, the Zobrist key, and the transposition table

`recon-abilities-items.md` §6.1 makes every ward **one-shot**, and its §8 question 5 flags the
consequence: *"Move generation is no longer a pure function of piece positions… Flag this early; it
affects transposition-table keys."* That warning is correct. Here is what it costs.

**What the legal move set actually depends on:**

```
generate(state) = f( occupancy, pieceClass, pieceType, wardIntact, boundBy,
                     status (slp/frz => cannot move; par => halved range),
                     itemPresent (Iron Ball, Ring Target, Shed Shell, Choice lock),
                     abilityArchetype (WARD / EDGE-pierce / BIND / STRIDE),
                     fieldState (Gravity disables RAY_ANY; terrain),
                     hazardLayers,
                     publicRoll (FLINCH type => that type cannot capture this turn),
                     chainLeft, bonusPieceMask )
```

**The key must be factorised, not a product.** One key per
(square × pieceCode × type × ward × vigour × status × …) is 82 million keys. One **independent** table
per dimension, XORed, is 6,500:

| Table | Entries |
|---|---|
| `Z_piece[square][pieceCode]` | 64 × 13 = 832 |
| `Z_type[square][type]` — **the one a chess engine does not have** | 64 × 18 = 1,152 |
| `Z_ward[square]` | 64 |
| `Z_vigour[square][v+3]` | 64 × 7 = 448 |
| `Z_status[square][st]` | 64 × 7 = 448 |
| `Z_charges[square][slot][n]` | 64 × 4 × 6 = 1,536 |
| `Z_pristine[square]`, `Z_item[square]` | 128 |
| `Z_side`, `Z_chainLeft[0..2]`, `Z_critType[18]`, `Z_flinchType[18]` | 40 |
| `Z_field[weather][terrain]`, `Z_hazard[square][layer]` | ~300 |
| **Total** | **≈ 6,500 keys × 2 × 32 bits = 52 KB** — allocate once |

[P2]'s prototype implements the first two (14,976 keys) with incremental XOR through make/unmake at
~2 ns per move.

**Two things the key must NOT contain**, both silent-failure traps:

- **The PRNG counter.** `recon-variants.md` §4.3 flags this for repetition detection; it applies to the
  TT too. A monotonic RNG state makes every key unique and the table dead. Worth restating because it
  will be written by a different person than the one who read that section.
- **Anything the mover cannot observe.** With abilities and items public
  (`recon-abilities-items.md` §4.2) this holds — an unremarked benefit of that decision, because hidden
  information would force an information-set search, a different and much harder algorithm. `Illusion`
  is the sanctioned exception; model it as a *known* decoy on the AI's side (the AI plays honestly; the
  human is the one fooled).
- **[P1]'s HP warning still applies if HP ever returns:** 32 pieces × N HP values explodes the key space
  and destroys hit rate. Bucket it (full / hurt / critical / 1) and hash the bucket.

**What the extra state costs, measured [P2].** More state ⇒ fewer real transpositions ⇒ fewer value
cutoffs. I measured the extreme by keeping the TT as a best-move cache only:

| Depth | TT value cutoffs ON | TT as move-cache only | Cost |
|---|---|---|---|
| 8 | 154 ms (EBF 3.80) | 435 ms (EBF 4.86) | 2.8× |
| 9 | **601 ms** (EBF 3.97) | **2,069 ms** (EBF 5.01) | **3.4×** |
| 10 | 2,533 ms (EBF 4.18) | 11,207 ms (EBF 5.40) | 4.4× |

**≈1 ply at a 1-second budget.** Acceptable, and mitigable three ways:

1. **Epoch-split the key.** Hash the *slow-moving* state (types, wards, items, abilities, field) into a
   single `epoch` word that changes only on a rare event — a ward popping, a Tera, a type mutation, a
   weather change. Probe with `(Z_piece ⊕ Z_side ⊕ Z_chain ⊕ Z_roll ⊕ epoch)`. Transpositions *within* an
   epoch — the overwhelming majority of a search — still work, and epochs change at most a couple of
   dozen times per game (≤8 wards per side, one Tera per side).
2. **Keep the TT anyway.** The measurement above retained full best-move ordering; the alternative (no
   TT at all) had EBF 28–42. The best-move cache is worth ~3 plies on its own.
3. **Always validate a TT move before playing it.** Because legality is state-dependent, a stale entry
   can hand back a move that is now illegal (ward popped, piece bound, type changed). Verify membership
   in the freshly generated list. Twenty lines, and the difference between an engine that works and one
   that occasionally plays an illegal move.

**Table sizing [P1]:** 2²² × 16 B = 64 MB blows the memory budget. Use **2²⁰ × 16 B = 16 MB**,
single-probe, replace-if-depth ≥ stored, `{key32, move16, score16, depth8, flags8}` packed into two
`Int32Array`s — no objects, no GC.

**On incremental move generation: mostly don't.** A dirty-piece incremental attack table is where variant
engines acquire their hardest bugs, and state-dependent legality is exactly what makes it fragile — a
ward popping invalidates attack sets unrelated to the piece that moved. `genMoves` costs **194 ns** for a
full board, ~35% of a node; spend the engineering on ordering (worth 3 plies) rather than on saving 35%
(worth 0.2 plies). Do keep **[P1]**'s three cheap wins:

1. **Staged generation** — yield the TT move first and return immediately on a cutoff (avoids generating
   anything at ~60% of nodes in chess engines).
2. **The type-legality filter is free**: `EFF[t_att*18 + t_def] === 0 → skip`, one byte read. It
   *reduces* branching by ~2.5% of captures — the only place the variant makes search easier than chess.
3. **Preallocated `Int32Array(256)` move buffer per depth** — zero allocation in the hot loop, which is
   why both prototypes hit their nps.

And two accumulators, because they are pure sums and trivially correct:

- **Type-aware material** — 4 ns to read vs 76 ns to rescan, a 19× saving on the term evaluated at every
  leaf.
- **A per-side 18-element type-count vector** — `recon-variants.md` §3.3 needs it for
  `LIAB/ARM/BLOCK/BONUS` with live weights `ŵ` and specifies the requirement precisely: "O(1) per
  capture, no per-node loop over 18 types". Two `Int8Array(18)`s. This is also **[P1]**'s `armyFit`
  cache: it depends only on the multiset of enemy types, which changes at most once per capture.

## B.6 The evaluation function

### B.6.1 Shape, and the tier each term sits in

The measured costs in §B.2 dictate the structure: terms are placed by how often they can afford to run.

```
eval(state, side) =
  ── TIER 0: incremental, 4 ns, every node ──────────────────────────────────────────────
    Σ_p sign(p) · [ m(class_p) · (1 − α·LIAB(t_p, ŵ) + β·ARM(t_p, ŵ) − ε·BLOCK(t_p, ŵ))
                    + τ·BONUS(t_p, ŵ) ]        // recon-variants.md §3.2 verbatim.
                                               //   α=0.9 β=0.5 ε=0.3 τ=0.5 (=50 cp)
  + Σ_p sign(p) · PST[class_p][square_p][phase]
  + w_tempo · (side has the move)
  + w_ward  · (wardsIntact(us) − wardsIntact(them))     // one-shot ward ≈ half a tempo (25 cp).
                                                        //   Betza prices PERMANENT uncapturability at
                                                        //   5–10x; one-shot is nothing like that, and
                                                        //   over-pricing it makes the AI hoard wards
  + w_stat  · (statusScore(us) − statusScore(them))     // slp/frz ≈ piece worth ~0 for 1–3 turns;
                                                        //   par ≈ −15% of m; brn ≈ −8%; psn/tox a countdown
  + w_chain · (chainLeft > 0 ? 40 : 0)                  // an unspent bonus move is real value

  ── TIER 1: lazy — only when |tier0 − α| < MARGIN (≈250 cp) — ~470 ns ─────────────────
  + w_mob   · Δ mobility            // legal sub-moves, capped at 8–12/piece, counting type-illegal
                                    //   captures as 0 — else the AI over-values a Ground rook
                                    //   staring at a Flying wall  [P1]
  + w_thr   · Δ superEffectiveThreats        // SE captures available now, weighted by victim value
  - w_vul   · Δ superEffectiveVulnerability  // the same with colours swapped, weighted HIGHER:
                                             //   fear beats greed, standard in chess evals  [P1]
  + w_king  · Δ kingRing            // weighted attackers on the 8 king-adjacent squares,
                                    //   × (1 − immunityFraction(king)) — a Ghost king attacked only by
                                    //   Normal/Fighting pieces is NOT in danger.  [P1]
                                    //   NO check term: king capture is terminal
  + w_haz   · hazardPressure        // Σ over enemy hazard squares of P(we must step there) × layer cost
  + w_bind  · Δ boundPieces

  ── TIER 2: root only, once per search, ~50 µs ───────────────────────────────────────
  + w_cov   · Δ typeCoverage        // |{enemy types we can hit at ≥1×}| / 18, ~12 cp per type covered.
                                    //   This is the term that punishes a Normal-heavy army (zero SE
                                    //   matchups) and prices the Gym-Leader mono-type puzzle (§B.8)
  + w_imm   · immunityShield        // Σ over our pieces of 0.10·value(p) if NO enemy piece has a legal
                                    //   capture of p — prices the "untouchable Flying piece" problem
                                    //   into the eval instead of leaving it a rules exploit  [P1]
  + w_supply· scarce-type ownership (Steel repels or kills 11/18 attacker types)
```

**Why the tiering.** Mobility and threats measured at 6.2–6.5× the material eval = 2.4× on search speed
≈ 1.25 plies. Lazy evaluation recovers almost all of it because most leaves are far outside the window
([P1] independently specified the same two-tier scheme with a ±200 cp margin).

**The threat term is free — put it in quiescence.** Quiescence already enumerates every capture at every
leaf; accumulate `Σ staticClash(a,d)` while doing so. That is a *better* threat term than a static scan
(it is actual available captures, correctly type-filtered) and it costs nothing. The term that measured
most expensive as a static scan is free as a by-product of a search we already run.

**[P1]'s design judgement, kept on record because it is the most important thing in this section:** the
static per-type multiplier has a small spread. The terms that actually carry the variant —
`typeCoverage`, `superEffectiveThreats`, `superEffectiveVulnerability`, `immunityShield`, and the
king-safety immunity discount — are all **relational**: they depend on *which types the opponent
drafted*. That is the right shape, because it is what makes "I know types" convert into "I win": the
strong player reads *this* enemy army, not a tier list. **If you implement only one non-chess eval term,
implement `superEffectiveVulnerability`.**

**Weights must be fitted, not chosen.** `recon-variants.md` §1.6 is unambiguous: Betza's four
hand-balanced armies were pronounced equal by human masters and later scored
**+62% / +19% / −11% / −71%** over 400 engine games. Ship `recon-variants.md` §3.2's coefficients as
*initial* values, then tune by self-play (SPSA or Texel-style) using the batch simulator (§B.7.4).
Budget 2 weeks for the harness and the first calibration; treat it as ongoing.

### B.6.2 The replacement for SEE: outcome-aware static clash

The most important single function in the AI — it drives move ordering, quiescence pruning, and the "is
this capture good?" question the whole game turns on.

```ts
/** Expected material delta of capturing `d` with `a`, before any search. Pure table lookups. */
function staticClash(a: Piece, d: Piece, roll: PublicRoll): number {
  const e = EFF[a.type][d.type];              // 0 | 0.5 | 1 | 2  (Uint8Array(324))
  if (e === 0) return ILLEGAL;                // never generated
  const isCrit = roll.critType === a.type;    // input randomness: KNOWN, not sampled
  const bonus  = e >= 2 || isCrit;
  const dies   = e === 0.5 && !isCrit;        // deterministic mutual destruction
  return value(d)
       - (dies ? value(a) : 0)
       + (bonus ? TAU : 0)                    // TAU = 50 cp
       - (a.item === 'lifeorb' ? VIGOUR_CP : 0);
}
```

This is `recon-variants.md` §2.4B's `E[Δ] = v − P(death)·u + P(bonus)·τ` evaluated with the *known* roll
rather than an expectation — which is what input randomness buys. It reproduces that document's key
result automatically: a queen taking an undefended knight nets only +0.53 pawns, so the AI stops
throwing queens at minor pieces, which is what makes it feel like it understands the game.

Ordering key: `staticClash` descending → TT move → **captures that grant extra moves** (the sharpest
tactic in the game **[P1]**) → killers → history → quiets by PST delta.

### B.6.3 What "quiescent" means here

In chess a position is quiet when there are no captures. Here there are three more sources of
instability, and all must be searched or the eval is systematically wrong:

1. **Any capture is unstable**, including a losing one, because mutual destruction means a capture can
   cost the mover a piece independent of recapture. **Do not prune losing captures by SEE [P1]** —
   capturing a queen with a pawn at 0.5× is a *good* trade (you spend a pawn to guarantee a queen dies).
   Prune by `staticClash > −50 cp` instead. **That single change is what will make the AI play the
   variant rather than play chess badly.**
2. **An unspent bonus move is unstable.** A leaf with `chainLeft > 0` and a super-effective capture
   available is not a resting position. Quiescence must follow bonus chains (both prototypes do).
3. **A pending delayed effect is unstable** (Future Sight, Doom Desire, Perish Song, Wish — the D5 class
   in `recon-moves.md` §5). Horizon-extend by the pending duration, which the dataset bounds at 5
   (`condition.duration` max = 5), so the extension is provably finite.

Quiescence depth limit: 6 plies.

## B.7 Engineering

### B.7.1 Web Worker — mandatory, not an optimisation

Think time reaches 3 s; a frame is 16.7 ms. The search is **180× a frame**, so on the main thread that is
a frozen board and an INP of seconds. [Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers)
are the only option. In a Worker the board keeps animating the "thinking" indicator at 60 fps and the
human can still hover squares and read the type panel.

```ts
// main -> worker
{ type: 'search', position: SerializedPosition, seed: number,
  difficulty: Difficulty, softMs: number, hardMs: number, id: number }
{ type: 'abort', id: number }
// worker -> main
{ type: 'progress', id, depth, nodes, bestMove, scoreCp }   // once per completed depth
{ type: 'result',   id, bestMove, scoreCp, depth, nodes, ms }
```

- The Worker imports the **same** `src/engine` module the UI does — the payoff of `BRIEF.md` §4.2's
  pure-engine rule. No duplicated rules, and the Worker is trivially testable in Node.
- `SerializedPosition` is a compact struct (`Int8Array` board, `Uint8Array` types, flags) transferred as
  an `ArrayBuffer` — zero-copy, no `structuredClone` of objects. It is ~1 KB, negligible next to a 600 ms
  search, and it is the same bytes as the replay format and the future network payload.
- **`progress` per depth** so the UI shows a real "thinking, depth 8" indicator and an eval bar, which
  makes the wait feel intentional.
- **No `SharedArrayBuffer`**, so no COOP/COEP headers, so plain static hosting still works.
- The Worker loads only the type chart (0.33 KB), the packed move-effect table (~21 KB) and the
  ability/item archetype records (~0.7 KB) — **~22 KB**, never `species.json` or `learnsets.json`.
- Lint rule: nothing under `src/ui/**` may import `src/ai/search.ts`.

### B.7.2 WASM — no, and here is the arithmetic

Measured JS throughput **7.1 Mnps [P2]** / 3.0–3.3 Mnps **[P1]**, and 8.5 M legal-nodes/s for pure
movegen **[P1]**. Typed arrays and monomorphic call sites get JS within ~2–3× of C for this workload.
Jangda et al., *Not So Fast: Analyzing the Performance of WebAssembly vs. Native Code* (USENIX ATC 2019,
<https://www.usenix.org/conference/atc19/presentation/jangda>) measured WASM at **1.45–1.55× slower than
native C** on SPEC, so WASM is not a route to native speed either; the realistic win over well-JITed
typed-array JS on a branchy, small-working-set search is **1.5–2.5×**.

At EBF 4.0, a 2× speedup buys `log₄(2) = 0.5 plies`. In exchange: a second toolchain, a second language
for the *rules* (or a rules re-implementation — the exact bug factory `BRIEF.md` §4.2 exists to
prevent), and a larger Worker chunk. **Reject.**

Four things each buy more, in descending order:

| Change | Gain |
|---|---|
| Keep resolution deterministic within a turn (input randomness) | **~4 plies** (measured 100–160×) |
| Epoch-split the TT key so value cutoffs survive state-dependence | **~1 ply** (measured 3.4× at depth 9) |
| Lazy evaluation of the mobility/threat tier | **~1.25 plies** (measured 2.4×) |
| LMR + futility pruning | ~1–2 plies (standard; unmeasured here) |

**One WASM-shaped opportunity for v3:** 64-bit bitboards. Movegen is 194 ns / 35% of node cost and
bitboards would cut it several-fold — but JS has no fast 64-bit integer (`BigInt` is far slower than two
32-bit halves, and the two-half trick eats most of the win). WASM's native `i64` is precisely the
capability JS lacks. Revisit *only* if movegen becomes the bottleneck. Likewise **Lazy SMP** across 4
workers (~1.7–2.5×, another ~0.5 ply) needs a shared TT and therefore `SharedArrayBuffer` — not v1.

### B.7.3 Iterative deepening and time management

```
soft budget = 0.55 × difficultyMs      // do not START a new depth past this
hard budget = 1.30 × difficultyMs      // ABORT mid-depth; return the last COMPLETED depth's move
```

- **Check the clock every 4096 nodes** (a counter compare, not `Date.now()` per node). At 7.1 Mnps that
  is 0.58 ms of granularity.
- **On hard abort, discard the partial depth.** A partially searched iteration can return a worse move
  than the previous depth — this is how engines blunder under time pressure.
- Predict the next iteration from the measured EBF ≈ 4.0 and stop early rather than abort late.
- **Aspiration windows** `[prev − 40, prev + 40]`, widening ×4 on failure. Under root-level Monte Carlo,
  reuse future *i−1*'s score as future *i*'s aspiration centre — they are highly correlated because of
  common random numbers.
- **A 350 ms minimum think time** even when the answer is instant (mate in 1, one legal move). An
  opponent that replies in 4 ms reads as a script. Fill it with the thinking HUD.

### B.7.4 Headless batch simulation — the new sandbox requirement

`DIRECTION.md` now requires "headless batch simulation. Run thousands of AI-versus-AI games and report
outcome distributions, game length, capture-outcome frequencies, per-type win rates, and first-player
advantage." Measured single-threaded in Node **[P2]**:

| Node budget/move | games/s | mean plies | mean captures | mean SE captures | mean mutual |
|---|---|---|---|---|---|
| 500 | **66.3** | 261.0 | 3.4 | 0.8 | 0.3 |
| 2,000 | **25.9** | 126.9 | 9.9 | 1.9 | 0.5 |
| 10,000 | **10.3** | 55.2 | 9.3 | 1.8 | 0.3 |
| 50,000 | **1.4** | 101.2 | 15.7 | 2.5 | 1.0 |

So **10,000 games at 2,000 nodes/move ≈ 6.4 minutes single-threaded, ≈1 minute across 8 workers**. This
is comfortably affordable and it is how `recon-variants.md`'s balance claims get *tested* rather than
asserted.

Three engineering requirements this places on the AI:

1. **Budget in node counts, not wall-clock.** A time-budgeted search gives different results on
   different machines and in different CI runs, so a batch run would not be reproducible. Expose both:
   `budgetMs` for play, `budgetNodes` for simulation and for regression tests.
2. **Run it in the same Worker code path** as play, driven from Node in CI and from a Worker pool in the
   browser sandbox. One searcher, two hosts — the pure-engine rule again.
3. **Stream aggregate counters, never per-game state**, or the UI becomes the bottleneck.

Note the plies column is not monotonic in budget, and that is expected rather than a bug: weak searches
produce long shuffling draws (261 plies at 500 nodes, 51 of 60 games drawn), mid searches produce decisive
games (55 plies at 10,000), and stronger searches find longer forcing lines. Treat game length as a
*measured output* of the balance work, not a target.

## B.8 Difficulty: types, not depth — plus Gym Leaders

### B.8.1 The type-misjudgement dial, measured **[P1]**

The thematically right way to build a beginner AI for *this* game is not to make it search less — it is
to make it **wrong about types**, because that is exactly the mistake a new Pokémon player makes and
exactly the edge a knowledgeable player is supposed to have. `DIRECTION.md` now names this explicitly as
a requirement ("an AI that plays the variant properly and misjudges *types* at lower difficulties").

Implementation: the AI gets its own `EFF` table, in which each of the 324 entries is, with probability
`typeErrorRate`, replaced by a uniformly random value from {0, ½, 1, 2}. It plays *correct chess* with a
*wrong type model*. Illegal attempts are resolved by the true engine, so a confused AI occasionally tries
a capture that turns out to be no-effect — charming, legible, and exactly what a beginner does.

Measured, 30 games per row, agents otherwise identical, colours alternated:

| `typeErrorRate` | weak agent's score | record |
|---|---|---|
| 5% | **47%** | 10 W – 12 L – 8 D |
| 15% | **45%** | 10 W – 13 L – 7 D |
| 30% | **37%** | 8 W – 16 L – 6 D |
| 50% | **30%** | 7 W – 19 L – 4 D |
| 100% (type-blind) | **25%** | 5 W – 20 L – 5 D |

A **clean, monotonic dial that never bottoms out** — even a fully type-blind AI wins 25% because it
plays real chess. That is the ideal beginner opponent: beatable through Pokémon knowledge, not
frustrating, and it *teaches* — when it walks a Ground rook into your Flying bishop, the player learns
the immunity by watching the AI get it wrong.

A refinement worth taking over pure randomness: for the lowest tiers, corrupt the chart *the way humans
are wrong*. Keep the matchups a beginner knows (the starter triangle, Electric>Water, Ground>Electric)
and flatten the rest; at the intermediate tier keep the common matchups correct and be wrong about the
**8 immunities and Steel's 10 resistances** — the two things intermediate players demonstrably get
wrong (`recon-variants.md` §2.2 identifies Steel as the most contested and most misunderstood type).
Random corruption is the measured baseline; structured corruption is the same mechanism with better
characterisation, and it costs nothing.

### B.8.2 Gym-Leader promotion matches, and the compensation they need **[P2]**

`DIRECTION.md` adds mono-type Gym-Leader armies as the promotion gate between badge tiers. This lands
directly on my `typeCoverage` and `immunityShield` eval terms, and it needs one measurement before it is
designed: **is a mono-type army actually a fair fight?**

Measured, mono-type white army vs mixed black army, 40 games at equal search (2,000 nodes/move):

```
mono-type army: 9 W / 20 L / 11 D  =>  score 36%
```

**A mono-type army is ~14 points below even — roughly a 100–150 Elo composition handicap.** Two
conclusions:

1. **The design is validated.** A mono-type army *is* a readable, solvable puzzle worth real material,
   exactly as `DIRECTION.md` argues. The player who brings the right counters wins; that is the lesson.
2. **Gym Leaders must be compensated or every gym is a pushover.** Give the Leader a *larger* search
   budget or a *better* draft budget (the Really Bad Chess lever `recon-variants.md` §6.3 knob 5 already
   endorses) — not a corrupted type chart, because a Gym Leader should be a *type expert*. Suggested:
   Brock through Erika get +1 draft budget tier; Koga through Giovanni get +1 tier and +1 search ply.
   Then calibrate against the badge ladder's Glicko-2 numbers rather than guessing.

Caveats on the 36%: my probe assigned types randomly to piece classes with no real draft, and its eval
had no `typeCoverage` term (so *neither* side exploited the mono-type weakness deliberately). The true
gap is therefore probably **larger**, not smaller. Re-measure with the real draft and the full eval
before setting the compensation.

### B.8.3 The ladder

Three orthogonal knobs per level: **time budget**, **type-belief error**, and **blunder injection**
(with probability `p`, play a random move from the top-`k`). Depths are [P2]-adjusted upward from [P1]'s
table, because 7.1 Mnps with the full ordering stack reaches ~2 plies deeper at equal time.

| Level | Hard budget | Depth (est.) | `typeErrorRate` | Blunder | Eval | Est. strength | Feel |
|---|---|---|---|---|---|---|---|
| **Rookie** | 150 ms | 5–6 | **100%** (or structured: starter triangle only) | 12% from top-5 | Tier 0 | ~800 | Plays chess, ignores types. Loses trades to type knowledge constantly. |
| **Trainer** | 300 ms | 6–7 | **50%** (or: wrong on the 8 immunities + Steel) | 6% from top-3 | Tier 0 | ~1200 | Knows some matchups, confidently wrong about others. |
| **Gym Leader** | 700 ms | 8–9 | **15%** | 2% from top-3 | Tier 0+1 | ~1500 | Mostly right on types; punishes real mistakes. **Default.** |
| **Elite Four** | 1500 ms | 9 + R=4 root samples | **0%** | 0 | Tier 0+1+2 | ~1750 | Perfect type knowledge, full eval. |
| **Champion** | 3000 ms, 2²¹ TT | 9–10 + R=8 | **0%** | 0 | all, tuned | ~1900+ | Explicit "may take up to 3 s" label. |

Latency contract: `p50 = 0.55 × budget`, `p95 ≤ 1.3 × budget` (the hard abort guarantees the p95). The
CI gate to hold is **Elite Four p95 ≤ 1,200 ms over 200 stored positions [P1]**.

**The Elo column is an estimate, not a measurement** — anchored on node counts and the well-known
~50–70 Elo/ply relationship for material+PST evals at this depth. The *relative* ordering is measured
(§B.8.1); the absolute labels are not, and `recon-variants.md` §6.1 flags that even its pawn↔Elo constant
(1 pawn ≈ 70 Elo) is a modelling assumption. **Calibrate before shipping the labels:** run each level
against the flat-Monte-Carlo baseline and against each other in a 200-game round robin using the batch
simulator, publish the score matrix, and once the badge ladder exists, fit `P(win)` against
`(ΔElo_chess, Δtype-quiz-score)` as that document recommends. Anchor the difficulty names to badge tiers
so "Gym Leader ≈ Thunder Badge" means something.

**Anti-frustration rules, which matter as much as the numbers [P1]:**

- **The AI's displayed reasoning is honest at all levels.** If Rookie thinks Ground beats Flying, the
  hint panel must not secretly show the right answer. Its wrongness is content.
- **Never make a difficulty weaker by thinking slower.** Rookie at 150 ms feels snappy and dumb, which
  is right; a slow dumb AI is the worst combination.
- **Two extra levers that are more interesting than depth.** (i) **Army quality as difficulty** — Really
  Bad Chess deals armies by skill level; a sound opponent in a losing position is far more instructive
  than a blundering opponent in an equal one, and it is a one-line draft change. (ii) **Contempt / risk
  appetite** — a "Reckless" personality with a negative draw score and a higher `τ` hunts bonus chains
  and mutual-destruction trades; a "Cautious" one with a high `α` avoids them. Same search, same depth,
  different *character* — nearly free, and it makes five opponents feel like five opponents.
- **A "Chaotic" personality toggle [P1]**, orthogonal to difficulty, switches interior chance handling to
  single-sample so the AI genuinely gambles. Ship it labelled, never as the default, and document that it
  makes the AI non-deterministic.

## B.9 Effort estimate

"Agent-day" = one focused day with review. Rendering and AI only.

| Work item | Days | Notes |
|---|---|---|
| **Rendering** | | |
| Board refactor: pieces out of squares, CSS custom properties, layer stack | 2.0 | prerequisite for any animation |
| `Ticker` + `Presenter` + beat grid + `settle()` | 2.0 | the decoupling that makes "animation never gates play" true |
| `FxQueue` (pure, deterministic) + particle pool | 1.0 | |
| `Canvas2DRenderer` (two contexts) + 5 verdict effects + turn-start roll reveal | 2.0 | where "satisfying" is won or lost; budget for iteration |
| `StaticRenderer` + reduced-motion path + tests | 0.5 | |
| Type Glyph mode (0-asset fallback) | 1.0 | pure CSS/SVG, contrast-checked |
| `vendor-sprites.ts` + manifest + baked `spriteUrl`/`iconOffsets` + service-worker precache | 1.0 | [P1]'s probe already proved the download path |
| Thin `dex-index` chunk + virtualised Pokédex/collection grid | 1.5 | §A.5.7, §A.8.1 |
| Perf harness in CI (size-limit, frame/memory/node-count gates) | 1.5 | the gates in §A.6 |
| **Rendering subtotal** | **12.5** | |
| **AI** | | |
| Position + movegen + perft + `chess.js` differential tests | 2.0 | `board.ts` exists; [P1]'s prototype passes `perft(5)`; productionising with types/status/wards is the work |
| Alpha-beta + PVS + iterative deepening + time management | 1.5 | reference implementation exists (`tech-recon-search2.mjs`) |
| Quiescence with `staticClash` pruning + bonus-chain following | 1.0 | the variant-specific part |
| Factorised Zobrist + TT + epoch-split + TT-move validation | 2.0 | §B.5; the epoch split and the validation are new work |
| Move ordering (TT, `staticClash`, extra-move-first, killers, history) | 1.0 | biggest strength-per-day item |
| Eval Tier 0 (incremental material, PST, ward/status/chain) | 1.5 | |
| Eval Tier 1+2 (the relational type terms, lazy-eval gating, root caching) | 2.0 | the soul; needs tuning iterations |
| Root-level Monte Carlo with common random numbers | 0.5 | |
| Worker plumbing + protocol + abort + progress + node-budget mode | 1.5 | |
| Difficulty system (type-error, structured corruption, blunder, personalities) | 0.5 | measured, mechanically simple |
| Batch simulator + Worker pool + aggregate reporting | 1.5 | new `DIRECTION.md` requirement |
| Self-play weight calibration + 200-game round robin + score matrix | 2.0 | non-negotiable per `recon-variants.md` §1.6 |
| Search regression bench in CI (nodes + p95 latency gates) | 1.0 | |
| **AI subtotal** | **18.0** | |
| **Total** | **30.5 agent-days** | plus ~15% contingency for eval tuning ⇒ **~35** |

**Ship order.** v1 = board refactor + Presenter + Normal/Fast speeds + vendored `gen5` stills + Gym
Leader AI only (Tier 0+1 eval, `staticClash`, 700 ms) ≈ **15 days**. v1.1 = full FX suite, reduced
motion, all 5 difficulties, Type Glyph mode, batch simulator ≈ 10 days. v2 = HD/animated sprites,
Tier 2 eval, Champion, calibration, Gym-Leader ladder ≈ 10 days. Everything in v1 is on the critical
path; nothing in v1.1+ is.

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

Every mechanic in `recon-moves.md` and `recon-abilities-items.md` lands behind `generate`/`apply`; the
searcher never needs to know Rough Skin exists. `recon-variants.md` §6.4 warns that "Guarded mode"
creates two legality paths — this interface is where that is prevented: Guarded mode is a **filter over
`generate`'s output**, never a second generator.

---

## 2. Conflicts, corrections and open questions

Ordered by how much they cost if ignored.

1. **`recon-data-substrate.md` §6 is materially incomplete on sprite delivery, and it matters.** It
   recommends hotlinking Showdown's CDN "to avoid redistributing" the art. Measured twice now: Showdown
   sends **no `Access-Control-Allow-Origin`**, so hotlinking works *only* for CSS `background-image` /
   `<img>` and forecloses canvas pixel access, WebGL, runtime atlasing, sprite-derived particles,
   screenshots, and any straightforward offline story. **Ruling: vendor same-origin at build/deploy time
   (§A.5.4–A.5.6), keep the art out of git, and ship Type Glyph mode as the zero-asset fallback.** This
   also resolves the `BRIEF.md` §4.6 offline requirement, which the hotlink plan silently violated.
2. **`recon-variants.md`'s input randomness is now a joint balance + AI requirement.** It recommends
   revealing the roll at turn start on balance grounds; I measure that full chance-node enumeration
   otherwise costs 100–160× (≈4 plies) and star1 does not rescue it. **Ruling: input randomness is
   load-bearing for the AI architecture.** If it is ever revisited, Part B must be re-derived and the
   difficulty ladder drops roughly 400 Elo.
3. **The two passes disagree on star1's sign (−1.7× vs +1.2×) and agree on the verdict.** [P1]'s
   structural explanation — few outcomes, loose bounds, so star1 *widens* the child window — is the one
   to keep. **Ruling: implement neither star1 nor star2.**
4. **`recon-abilities-items.md` §8 q5 is right, and now quantified.** One-shot wards make legality
   state-dependent, costing ≈1 ply (measured 3.4× at depth 9 in the worst case) unless the TT key is
   epoch-split. **Ruling: keep the one-shot ward — it is the best answer to the untouchable-piece
   problem — and pay for it with epoch-splitting and TT-move validation (§B.5).**
5. **[P1]'s §B.3.2 probability table is superseded** because it bakes in P(crit) = P(miss) = 1/6 from the
   video's rules, while `recon-variants.md` §6.3 sets γ = φ = 1/18. Its *ordering* survives and is
   confirmed independently: Steel best defensively, Bug and Grass worst overall, Normal with zero
   super-effective matchups. **Ruling: use `recon-variants.md` §3.2's value model in the eval; keep
   [P1]'s table as a cross-check only.** And note [P1]'s warning ("the die is doing more work than the
   types") was correct and **has already been acted on** by that document.
6. **The bonus sub-move should be optional; no doc currently says.** *Ruling (mine):* make it optional
   with an explicit `DeclineBonus` action. A mandatory extra move is an undesigned zugzwang mechanic, and
   the search needs the branch anyway.
7. **`recon-variants.md` §4.3's PRNG warning applies to the transposition table too**, not just to
   repetition detection. RNG state in the key makes every key unique and the table dead.
8. **The entry-chunk budget is a React budget.** 59.3 KB of 65.2 KB measured. **Ruling: gate at 110 KB
   gz; if breached, the answer is `preact/compat` (4.4 KB core measured, ~52 KB reclaimed), not shaving
   app code.**
9. **`species.json` must not be on the critical path** (76.9 KB gz vs a 17.4 KB columnar draft index).
   **Ruling: add the thin chunk.**
10. **The board should use 96 px stills, not the 40×30 icon sheet** (a 40×30 icon upscaled to 80 px is
    mush; a 96 px still downscaled to 80 px with `pixelated` is crisp). Keep the baked icon offsets for
    the Pokédex/draft/collection grids, which are now a much larger surface. **Ruling: both, per surface.**
11. **Chessground is the right architectural model and the wrong dependency** — GPL-3.0 vs this repo's
    Apache-2.0. Study it; do not link it.
12. **Gym-Leader mono-type armies score 36%** and therefore need compensation, and my number is probably
    an *under*-estimate of the gap because neither side in the probe had a `typeCoverage` term. **Action:
    re-measure with the real draft and the full eval before setting the buff.**
13. **My frame measurements were vsync-bound at 8.33 ms** — this machine has a 120 Hz display. A design
    tuned only to 60 Hz will judder on modern laptops. State budgets against the 120 Hz frame (~4 ms of
    JS) and treat 60 Hz as slack. The recommended architecture passes both with >2.5× margin at a 6×
    hardware penalty.
14. **The slow-hardware multiplier is the one unverified number in Part A.** [P1] assumed 3–5×, I use 6×.
    **Action:** run `bench.html` under DevTools 4× and 6× CPU throttling and on one real mid-range
    Android before the frame budget is treated as settled.
15. **What neither pass measured:** WASM (§B.7.2 argues against adding the toolchain), Lazy SMP, LMR /
    futility gains, and real Elo. **The Elo column in §B.8.3 is the softest number in this document** —
    treat it as a target to verify.
16. **Ability and item systems will re-open the search-cost question [P1].** Every ability that changes
    capture resolution adds branches. The architecture absorbs it gracefully — with input randomness the
    resolution is deterministic within a turn regardless of how many hooks fire — but the *eval* needs a
    term per archetype, scaling with `recon-abilities-items.md`'s 13 archetypes rather than with 310
    abilities. Budget it there, not here.
17. **`prefers-reduced-data` has poor support [P1].** Default Type Glyph mode on when it *is* present;
    otherwise offer it prominently.

---

## 3. Sources

**Rendering / web platform**
- MDN, CORS-enabled image — <https://developer.mozilla.org/en-US/docs/Web/HTML/CORS_enabled_image>
- MDN, `crossorigin` attribute — <https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/crossorigin>
- MDN, `image-rendering` — <https://developer.mozilla.org/en-US/docs/Web/CSS/image-rendering>
- MDN, animation performance and frame rate (compositor-only properties) — <https://developer.mozilla.org/en-US/docs/Web/Performance/Animation_performance_and_frame_rate>
- MDN, `will-change` — <https://developer.mozilla.org/en-US/docs/Web/CSS/will-change>
- MDN, `content-visibility` — <https://developer.mozilla.org/en-US/docs/Web/CSS/content-visibility>
- MDN, `prefers-reduced-motion` — <https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion>
- MDN, Web Animations API — <https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API>
- MDN, View Transition API (considered, rejected for board animation) — <https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API>
- MDN, Cache API — <https://developer.mozilla.org/en-US/docs/Web/API/Cache>
- MDN, Using Web Workers — <https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers>
- MDN, OffscreenCanvas (v2 option: move the FX draw into a worker) — <https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas>
- WAI-ARIA APG, `grid` pattern — <https://www.w3.org/WAI/ARIA/apg/patterns/grid/>
- web.dev, RAIL — <https://web.dev/articles/rail>
- web.dev, Interaction to Next Paint — <https://web.dev/articles/inp>
- Chrome, Time to Interactive — <https://developer.chrome.com/docs/lighthouse/performance/interactive>
- Chessground (DOM board, custom DOM diff, "10K gzipped", SVG overlay; **GPL-3.0**) — <https://github.com/lichess-org/chessground>
- PixiJS v8 — <https://pixijs.com/8.x/guides>; bundle measured from <https://cdn.jsdelivr.net/npm/pixi.js@8/dist/pixi.min.mjs>
- Motion (`animate`, `motion/mini`) — <https://motion.dev/docs/animate>

**Assets / licensing**
- Pokémon Showdown client (AGPLv3 code; `/sprites/` excluded from the repo) — <https://github.com/smogon/pokemon-showdown-client>
- `pkmn/ps` (MIT data + `@pkmn/img`) — <https://github.com/pkmn/ps>
- PokéAPI sprites (no LICENSE file; verified 404) — <https://github.com/PokeAPI/sprites>
- PokéAPI docs, fair-use policy — <https://pokeapi.co/docs/v2>

**Search**
- Ballard, B. W., "The \*-minimax search procedure for trees containing chance nodes", *Artificial Intelligence* 21(3):327–350, 1983 — <https://doi.org/10.1016/S0004-3702(83)80015-0>
- Hauk, Buro & Schaeffer, "Rediscovering \*-Minimax Search", *Computers and Games* 2006, LNCS 3846 — <https://link.springer.com/chapter/10.1007/11922155_3>
- Wikipedia, Expectiminimax (chance-node bound derivation) — <https://en.wikipedia.org/wiki/Expectiminimax>
- CPW: Expectiminimax — <https://www.chessprogramming.org/Expectiminimax> · Star1 — <https://www.chessprogramming.org/Star1>
- CPW: Quiescence — <https://www.chessprogramming.org/Quiescence_Search> · SEE — <https://www.chessprogramming.org/Static_Exchange_Evaluation>
- CPW: Zobrist — <https://www.chessprogramming.org/Zobrist_Hashing> · Transposition Table — <https://www.chessprogramming.org/Transposition_Table>
- CPW: Iterative Deepening — <https://www.chessprogramming.org/Iterative_Deepening> · PVS — <https://www.chessprogramming.org/Principal_Variation_Search>
- CPW: Killer — <https://www.chessprogramming.org/Killer_Heuristic> · History — <https://www.chessprogramming.org/History_Heuristic>
- CPW: LMR — <https://www.chessprogramming.org/Late_Move_Reductions> · Null-move pruning — <https://www.chessprogramming.org/Null_Move_Pruning> · Lazy eval — <https://www.chessprogramming.org/Lazy_Evaluation>
- CPW: MCTS — <https://www.chessprogramming.org/Monte-Carlo_Tree_Search> · UCT — <https://www.chessprogramming.org/UCT> · UCI — <https://www.chessprogramming.org/UCI>
- Browne et al., "A Survey of Monte Carlo Tree Search Methods", IEEE TCIAIG 4(1), 2012 — <https://ieeexplore.ieee.org/document/6145622>
- Silver et al., "A general reinforcement learning algorithm that masters chess, shogi and Go through self-play", *Science* 362, 2018 — <https://www.science.org/doi/10.1126/science.aar6404>
- Stockfish — <https://github.com/official-stockfish/Stockfish>
- Fairy-Stockfish — <https://github.com/fairy-stockfish/Fairy-Stockfish> · variant configuration — <https://github.com/fairy-stockfish/Fairy-Stockfish/wiki/Variant-configuration>
- stockfish.wasm (SharedArrayBuffer / COOP-COEP requirement) — <https://github.com/lichess-org/stockfish.wasm>
- chess.js (test oracle) — <https://github.com/jhlywa/chess.js>
- Jangda, Powers, Berger & Guha, "Not So Fast: Analyzing the Performance of WebAssembly vs. Native Code", USENIX ATC 2019 — <https://www.usenix.org/conference/atc19/presentation/jangda>

**Internal, treated as authoritative**
- [`DIRECTION.md`](./DIRECTION.md) — visuals and 60 fps as acceptance criteria; "animation must never gate play"; the AI must misjudge *types*; directives 4–6 (sandbox + batch simulation, collection/Pokédex, multiplayer, badge ladder, Gym-Leader promotion matches)
- [`BRIEF.md`](./BRIEF.md) — §4 pre-decided constraints (incl. §4.6 offline), §5 hard problems 7 and 8
- [`recon-data-substrate.md`](./recon-data-substrate.md) — §6 sprite sizes (used, not re-measured; and see conflict 1), §7 bundle discipline
- [`recon-moves.md`](./recon-moves.md) — §5 danger classes (the horizon-extension list), §6.5 bundle budget
- [`recon-abilities-items.md`](./recon-abilities-items.md) — §2.4 the Clash contract, §6.1 one-shot wards, §8 q5 (the TT-key warning), §7 bundle budget
- [`recon-variants.md`](./recon-variants.md) — §2.1 the 18×18 chart (independently reproduced here), §2.4 `E[Δ]` (the basis of `staticClash`), §3.2 the piece-value model (Tier-0 eval), §4 termination and sub-move counting, §5 the king-capture model, §6.1 the skill budget, §6.3 input randomness

---

## Appendix — probe inventory

Every table traces to one of these. **[P1]** probes were written in the first pass; **[P2]** in this one.

| Probe | What it measured | Headline |
|---|---|---|
| `/tmp/corstest/index.html` **[P1]** + inline Playwright re-run **[P2]** | CORS behaviour of Showdown sprites in a real browser | no ACAO ⇒ canvas tainted, WebGL `texImage2D` throws, `fetch` throws, `crossorigin` blocked; opaque responses are cacheable but unreadable |
| `/tmp/corstest/perf.html` **[P1]** | script ms/frame: 64 DOM pieces; 400 DOM particles; 400 & 2000 canvas particles | 0.092 / 0.449 / 0.235 / 0.417 ms mean |
| `/tmp/pcbench/bench.html` **[P2]** | frame intervals (4 architectures × 6 particle counts) and isolated per-frame CPU cost | canvas 0.842 ms @10,000 vs DOM 5.38 ms @4,000; DOM board rebuild 0.392 ms; 129 nodes |
| inline Playwright grid probe **[P2]** | Pokédex grid over 1367 formes | 65.44 ms plain / 30.86 ms `content-visibility` / **10.52 ms windowed** |
| `/tmp/corstest/look.html` **[P1]** | visual quality: gen5@80 px pixelated vs dex@80 px smooth | gen5 pixelated wins; screenshot inspected |
| `/tmp/corstest/atlas.html`, `atlas1025.html` **[P1]** | packed atlases at 3 scales, PNG/WebP | 2563 KB atlas vs **849 KB individual** ⇒ do not atlas |
| `/tmp/corstest/tti.html` **[P1]** | fetch + paint 32 sprites on a DOM board over HTTP/1.1 | 105 ms, FCP 76 ms, 32.7 KB |
| `probe_rendersearch_dl1025.mjs` **[P1]** | downloaded all 1025 gen5 sprites | **829 KB total, 1025/1025 present** |
| `probe_rendersearch_sizes.mjs` **[P1]** | byte census of 6 sprite sources + CORS headers | §A.5.1 table; `ani/` mean 62 KB, p95 146 KB |
| `probe_rendersearch_gaps.mjs` **[P1]** | gen-9 view vs National Dex | gen 9 misses **292** dex numbers incl. Alakazam, Machamp (since resolved) |
| `probe_rendersearch_img.mjs` **[P1]** | `@pkmn/img` output shape | it is a CSS `background-position` API; icon sheet 40×30, 12 cols |
| `probe_render_bundle.mjs` **[P1]** | baked-data payload sizes, gzip + brotli | columnar species 12.0 KB gz; learnsets 70.5 KB gz |
| `/tmp/bundletest` (esbuild) **[P1]** | tree-shaken library sizes | Pixi 165 KB gz, React 58 KB, `motion/mini` 3 KB, Preact 5.3 KB |
| rolldown + `curl`/`gzip` **[P2]** | real bundle sizes | React 19+DOM **59,285 gz**; Preact **4,376 gz**; `pixi.min.mjs` **231,272 gz**; chessground **12,089 gz** |
| `node -e` projections over the repo's `species.json` **[P2]** | thin-chunk sizing | 76,889 → **17,449 gz** columnar |
| `probe_render_perft.mjs` **[P1]** | move-gen correctness + speed | **perft(5) = 4,865,351 ✓** at 8.5 M legal-nodes/s |
| `probe_render_ab.mjs`, `probe_render_star2.mjs`, `probe_render_modeE.mjs` **[P1]** | plain vs variant; sound vs star1; chain caps | star1 **1.7× worse**; chain cap 2 costs **+53%** |
| `probe_rendersearch_search.mjs` **[P1]** | 6 chance-node strategies × 2 positions × depths 4–7 | sound 187 M nodes/65 s @d5; collapsed 43 k/34 ms ≈ plain chess |
| `probe_rendersearch_agree.mjs` **[P1]** | root-move agreement, cheap vs sound | G 42%, J 46%, root-hybrid 54%; root-exact overhead **+11%** |
| `probe_rendersearch_selfplay.mjs` **[P1]** | equal-node-budget match, sound vs collapsed interior | 120 games, **53.8% ± 4.6% ⇒ no significant difference** |
| `probe_rendersearch_typeerr.mjs` **[P1]** | difficulty via a corrupted type belief | 5%→47%, 15%→45%, 30%→37%, 50%→30%, 100%→**25%** |
| `probe_rendersearch_typevalue.mjs` **[P1]** | real gen-9 chart × variant capture semantics | per-type P(extra)/P(mutual)/P(survive) + the 8 illegal pairs |
| `/tmp/pkmn-probe/tech-recon-search.mjs` **[P2]** | 18×18 census; branching factor; naive no-TT baseline | 8/61/204/51; **30.9 mean legal moves, 3.27 captures, 0.34 SE**; EBF 28–42 without ordering |
| `/tmp/pkmn-probe/tech-recon-search2.mjs` **[P2]** | engineered searcher: flat move stack, factorised Zobrist over (square, pieceCode, **type**), TT, killers, history, quiescence following bonus chains | **7.1 Mnps, EBF 3.8–4.2, depth 9 in 601 ms.** *Port this into `src/ai/`.* |
| `/tmp/pkmn-probe/tech-recon-search2b.mjs` **[P2]** | same with TT value cutoffs disabled | near-unique key costs **3.4× at depth 9 ≈ 1 ply** |
| `/tmp/pkmn-probe/tech-recon-chance.mjs` **[P2]** | deterministic / full expectiminimax / EV-collapse / MC sample, depths 4–8 | full enumeration **121–159×** |
| `/tmp/pkmn-probe/tech-recon-star.mjs` **[P2]** | star1 + input randomness with configurable samples/ply | star1 +20% (cf. [P1]'s −1.7×); input randomness **+10–28%**; 3 samples/ply **531×** |
| `/tmp/pkmn-probe/tech-recon-eval.mjs` **[P2]** | per-term eval cost | 4 ns incremental / 76 ns material / 194 ns `genMoves` / 470–496 ns mobility+threats |
| `/tmp/pkmn-probe/tech-recon-batch.mjs` **[P2]** | self-play throughput and the mono-type army check | **66 / 26 / 10 / 1.4 games per second**; mono-type army scores **36%** |

Nothing in this document required modifying the repository outside this file.
