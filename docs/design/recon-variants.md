# Recon: Chess-Variant Prior Art & Game Balance

**Role:** chess-variant / game-balance analyst.
**Scope:** the six on-camera bugs in §2 of `BRIEF.md`, piece values under our rules, a termination proof,
one coherent check/king model, and a quantified skill budget.
**Method:** prior-art research (URLs cited inline), plus numbers measured on this machine against
`@pkmn/dex@0.10.11` / `@pkmn/data@0.10.11` (probe scripts named `probe-variants-recon*.mjs` in `/tmp/pkmn-probe`).

---

## 0. Executive summary — the six bugs, resolved

Every one of the video's "unresolved" problems has a battle-tested answer in an existing variant. We should
adopt, not invent. The single coherent model:

| # | Bug | Recommendation | Prior art it comes from |
|---|---|---|---|
| a | capture-while-in-check + mutual destruction | **Abolish check-legality.** Any move is legal; leaving your King attacked is a risk, not an illegality. | Duck Chess, Fog of War Chess, Losing Chess, single-die Dice Chess, ICC Atomic |
| b | king capture vs checkmate | **King capture.** Checkmate becomes a UI label, not a terminal state. | same set |
| c | can mutual destruction remove a checking piece? | **Yes, and it is a legitimate defence.** It is the defining tactic of Kamikaze Chess. | Kamikaze Chess (Laws, 1928) |
| d | is a move that kills your own King legal? | **Illegal iff it *deterministically* kills your King. Legal (with probability shown) if it only risks it.** | Atomic Chess rule 5, verbatim |
| e | both Kings die in one exchange | **The mover wins.** | Lichess Atomic: exploding the enemy king "overrides all checks and checkmates" |
| f | is suicide-capture a feature? | **Feature — but make it *deterministic* (type-driven), never dice-driven.** | Stratego (equal ranks both die), Kamikaze Chess |

And the three headline balance conclusions, each with a number behind it:

1. **The dice as specified are catastrophic and the type chart doesn't need them.** Under the video's rules
   a single capture carries a material standard deviation of **0.58 pawns (pawn attacker) to 4.43 pawns
   (queen attacker)**; over a ~18-capture game that is **≈5.5 pawns of pure noise**, i.e. decisive. Type
   knowledge alone is worth **≈0.5 pawns per capture ≈ 10 pawns per game** against a type-blind opponent.
   The equaliser is the type chart, not the d6. Cut the dice hard.
2. **Move the randomness before the decision.** The video rolls *after* you commit ("output randomness").
   Every dice-chess variant that survived rolls *first* and then lets you choose among the moves the roll
   permits ("input randomness"). That one change is the difference between skill-expressive and skill-destroying.
3. **The "infinite turn" fear is unfounded — the bound is 16, provable in one line.** A bonus move is granted
   only by a capture; every capture strictly decreases the enemy piece count; therefore a turn has at most
   `1 + (enemy pieces) ≤ 16` sub-moves and a whole game has at most 30 bonus moves. We cap at 3 sub-moves
   for *feel*, not for termination.

---

## 1. Prior art

### 1.1 RNG in chess: how the survivors keep RNG from eating skill

**Dice Chess** (<https://en.wikipedia.org/wiki/Dice_chess>) — the important structural fact is the *order of
operations*. In the main two-dice version, faces map to piece types (1 pawn, 2 knight, 3 bishop, 4 rook,
5 queen, 6 king) and a player "may move pieces indicated on die or dice thrown"; doubles are a wildcard
("may play any legal move"). **You roll, and then you choose.** Randomness constrains your option set; it
never overturns a decision you already committed to. Gollon's other forms do the same thing (one roll sets
how many moves you get, capped at four; a two-coloured-dice version sets piece and move-count). The
larger 10×10 form with two kings per side is described as reducing "the impact of chance" and adding
"strategic depth" — i.e. more royal targets ⇒ less single-point-of-failure variance.

**Knightmare Chess** (Steve Jackson Games 1996, from Cléquin & Faidutti's *Tempête sur l'échiquier*;
<https://en.wikipedia.org/wiki/Knightmare_Chess>) — cards that override the rules, again drawn into a hand
and then *played by choice*. Two features are directly reusable:
- **Every card carries a point cost**, and a deck's disruptive strength is the sum of its cards' points.
  "Matching point totals produce an even contest, while a skilled player can take a reduced total as a
  handicap." — this is a shipped, commercial precedent for point-buy asymmetry *plus* point-buy handicapping.
- **Asterisked cards are limited to one copy per deck.** A restricted list on top of point-buy.
- Reception is the cautionary note: reviewers consistently liked it but found the clash of orderly chess and
  disorderly cards "a bit jarring", and "utterly bonkers … best played every now and then" (Arcane #13, 7/10).
  Bolted-on chaos reads as a novelty unless it is integrated.

**Chess Evolved Online** (500+ collectible units, custom armies, ranked PvP;
<https://store.steampowered.com/app/1064340/>) — the largest drafted-army chess game in existence states as
a headline design principle: "**PvP-enabled units have zero RNG of any kind. Any form of ambiguity is
resolvable and deterministic** (heart of the cards can't save you once the match begins — even in draft
mode)" and "no unit is 'strictly better' than another — no 'rarity' is considered stronger". The people who
took drafted chess armies furthest deliberately removed all randomness.

**Pawnbarian** (<https://store.steampowered.com/app/1142080/>) — "Use a deck of chess pieces"; you draw a
hand, then plan. Input randomness again, and the designer explicitly rejects build variance
("No complex and varied builds … the bulk of the roguelike depth lies in how you approach the emergent
combat puzzles").

> **Adopt:** roll before the decision, never after. Reveal the turn's entire random state at the start of the
> turn, publicly, and let both players plan around it.

### 1.2 Mutual destruction and collateral: Atomic, Kamikaze, Stratego, Archon

**Kamikaze Chess** (a.k.a. *Hara-kiri Chess*; B. G. Laws, *The Problemist* #196, January 1928;
<https://www.chessvariants.com/difftaking.dir/kamikaze.html>) — this is *exactly* our not-very-effective
rule, and it dates from 1928. Laws's original stipulation, verbatim:

> "When a man captures, both capturing and captured men are removed from the board."

Pritchard's *Encyclopedia of Chess Variants*, verbatim:

> "A piece making a capture is removed from the board together with the captured man. It follows that a king
> cannot defend himself by capturing an attacker."

Notes that matter to us:
- An earlier version of the page exempted Kings from the kamikaze effect; **Pritchard and AISE both reject
  the exemption** — the King is subject to it. "In AISE tournaments, the King is subjected to the kamikaze
  effect. Therefore if the player must make a capture with the king, he loses the game."
- Composed *problems* exist with "White mates in 2" stipulations, and helpmates. **So checkmate is perfectly
  well-defined under mutual destruction** — the video's bug is not a rule problem, it is an implementation
  problem (they applied the deaths but did not re-test legality of the resulting position).
- **Kamikaze Progressive Chess** was an AISE tournament format: kamikaze captures *combined with*
  progressively longer move-series. The exact combination we are building (mutual destruction + extra moves)
  has been played competitively.

**Atomic Chess** — our (d)/(e) answer, verbatim. The canonical ruleset
(<https://www.chessvariants.com/difftaking.dir/atomic.html>, collected by Klaus Knopper from DICS, 1995):

> 1. The normal chess rules are valid.
> 2. Whenever a piece is captured, the capturing piece is removed and all pieces on the immediate
>    horizontal, vertical and diagonal neighbour fields.
> 3. Pawns are exceptions to rule 2. They are not destroyed by adjacent explosions, but cause explosions
>    that destroy themselves when capturing other pawns and pieces.
> 4. Explosions are non-recursive, meaning that only the pieces on the immediate neighbour fields are
>    removed, not pieces in further distance (no avalanche effect).
> 5. **It is illegal to blow up your own King, even if that destroys the opponent King as well.**
> 6. These rules imply that the King may never capture a hostile piece, avoiding his own explosion.

Lichess's rules (<https://lichess.org/variant/atomic>) add the tie-break and the check override:
- "It is illegal to capture a piece that would blow up your king." A king therefore can never capture.
- "**Any move that results in blowing up the opposite king will result in an immediate victory, overriding
  all checks and checkmates.**"
- Kings may stand adjacent; while connected, "checks do not apply" — neither side can be in check. You win
  from a connected-kings position by zugzwang or by detonating a piece beside the enemy king.

Wikipedia (<https://en.wikipedia.org/wiki/Atomic_chess>) adds the taxonomy we need:
- Two threat types: **"atomic check"** (a direct attack on the king) and an *indirect* threat, where a player
  "threatens to explode the king by capturing an adjacent piece."
- A checked player answers as in ordinary chess — move away, interpose, or capture the checker — "though not
  with the king, and not if the blast would kill your own king", **with one carve-out: the exception applies
  when the checked side "can win the game by exploding the checking player's king."** That carve-out is
  literally our bug (c)/(e): a mutual-annihilation reply that kills the checker outranks the check.
- **Rule-set divergence, and this is the important warning:** ICC enforces no check at all, "making legal
  any move, even one leaving the king to be captured directly in the next move." The consequence is that
  K+R vs K, a book draw everywhere else, "can become a forced win on ICC." Abolishing check-legality
  genuinely changes endgame theory. Own that trade.
- On simultaneous royal death, Wikipedia is explicit that the situation is **prevented rather than
  adjudicated**: a king "cannot be captured directly if it means destruction of the other", and
  self-destruction is barred, so there is no rule for both kings dying. Atomic dodges (e) by construction.

**Stratego** (<https://en.wikipedia.org/wiki/Stratego>) — the best prior art for *type-matchup* capture,
because it is a rank-comparison capture system with mutual destruction and immunity, refined over 80 years:
- "The higher ranked piece always captures the lower, except when stated otherwise."
- **"If the engaging pieces are of equal rank, both are removed."** Mutual destruction as a core, loved,
  everyday mechanic — not a bug.
- **Bomb = immunity, bounded by exactly one key.** "It immediately eliminates any other piece striking it
  without being destroyed itself … unless the attacking piece was a Miner." Each side gets 6 Bombs and
  **5 Miners** — the key is deliberately more numerous than the lock.
- **Spy = a one-way counter.** It beats the Marshal only when *it* attacks; "if the Spy attacks any other
  piece, or is attacked by any piece (including the Marshal), the Spy is defeated." Directional
  effectiveness, exactly like a type matchup.
- The failure mode is documented: pieces get "trapped behind bombs", and **games are drawn when both flags
  sit behind bombs and neither side retains a Miner** — immunity deadlock happens precisely when the key is
  gone. Guarantee the key.

**Archon: The Light and the Dark** (1983; <https://en.wikipedia.org/wiki/Archon:_The_Light_and_the_Dark>) —
the precedent for resolving a capture with a sub-battle rather than a comparison. Relevant points:
- Landing on an occupied square doesn't auto-capture; a stronger icon "usually prevails, but not always, and
  **a fight can result in both pieces being eliminated**".
- Board colour cycles; "each player having an advantage on squares of their own color" — a positional
  analogue of our type advantage.
- Asymmetric 18-piece armies of 8 types with per-type stats (force, attack speed, recharge, life-bar, each
  1–6) — and a documented degenerate matchup (phoenix vs shapeshifter is "a famously dull stalemate").
- **Three win conditions** (hold the five power points, wipe the enemy, or reduce them to one imprisoned
  piece) specifically so attrition games can't deadlock. And: "**If the last piece on each side kills the
  other, the game is a draw.**" That is the only clean statement of mutual-annihilation-as-draw I found.

**Rifle Chess** (Seabrook 1921; <https://www.chessvariants.com/difftaking.dir/rifle.html>) — captures happen
at a distance; the capturing piece does not move. One line of commentary is a warning we must heed:
> "This simple rule change changes the game a lot. For instance, **it is of no use to guard pieces.**"

If a capture no longer requires occupying the defender's square, the entire chess concept of *protection*
evaporates and with it most positional play. Our mutual-destruction rule flirts with this: check every
proposed rule against "does defending a piece still deter an attack?"

### 1.3 Extra / multiple moves per turn: degeneracies and the standard patches

**Marseillais Chess** (Marseille, 1925; played by Alekhine, Réti, Znosko-Borovsky, Chéron;
<https://en.wikipedia.org/wiki/Marseillais_chess>, <https://www.chessvariants.com/multimove.dir/marseill.html>)
— two moves per turn. The patches are the whole point:

> - "Each turn, a player makes two moves. He may move twice with the same piece, or he may make moves with
>   two different pieces. Castling counts as one move."
> - "**If a player gives check on his first move in a turn, he moves only once that turn.**"
> - "A player in check must remove the check in the first half of his turn."
> - "**A player may never move his King into check, not even on the first half of his turn.**"
> - En passant is allowed even against a pawn that moved on the first half-move, but the capture "must be
>   done on the first move of the turn."

Two degeneracies and their fixes:
- **First-player advantage.** "To ensure White's advantage of moving first is not excessive, usually a
  'balanced' version of the game is played … In the balanced version, White makes only *one* move on the
  first turn," giving W, B B, W W, B B … "This rule was introduced in 1963 by Robert Bruce and has gained
  wide acceptance since then" (AISE switched in 1990). Alessandro Castelli thinks unbalanced
  `1. e4/Nf3` and `1. d4/Nf3` "are theoretical wins for White." **One free move at the start is worth more
  than the entire classical first-move advantage.**
- **Check-then-king-capture.** Without the "check ends your turn" rule, a two-move turn lets you check and
  then take the king in the same turn. The rule exists precisely to force the opponent to get a reply.

And a directly transferable *piece-value* datum, from the chessvariants play notes:
> "The Queen is also weaker. **Its value probably doesn't exceed the value of two minor pieces.**"
> Also: "In the endgame, a Knight controls more squares than a Bishop"; "King and Rook wins also vs. either
> King and Bishop or King and Knight."

So a double-move rule drops the queen from ~9.5 to ~6.5–7 (−30%) and *raises* short-range pieces. Extra-move
mechanics compress the top of the value scale. Our numbers in §2 predict the same effect from a different
direction, which is reassuring.

**Progressive Chess** (<https://en.wikipedia.org/wiki/Progressive_chess>) — 1 move, then 2, then 3 … The
rules that generalise to any multi-move variant:
- "**A check must be escaped from on the first move of a series** — if this cannot be done, it is checkmate
  and the game is lost."
- En passant "must be made on the first move of a series."
- **The 50-move-rule analogue:** "10 consecutive turns with no captures and no pawn moves draws, unless one
  of the players can force a checkmate."
- Self-stalemate is a legal drawing resource: "it is possible to save a draw by stalemating oneself." (A
  degeneracy to avoid, see §4.)
- **Scottish rules:** "check may be given on any move of a series, but a check ends the series" — the
  Marseillais patch, generalised. **Italian rules:** check is legal *only* on the final move of a series.
  Beasley's 2011 study of 416 mating positions found 158 Italian mates, and only **one** case
  (Cassano–Dipilato 1986) where the Italian/Scottish distinction actually changed the result — so the
  cheaper rule (Scottish: check ends the series) costs essentially nothing.
- **English Progressive Chess** is the precedent for "a piece may not benefit twice in one turn":
  "within a turn, no piece may move twice until every other piece with a legal move has moved once, and so
  on; restrictions reset each turn."
- **Logical Progressive Chess** (Byway, *Variant Chess* 18, 1995) drops castling and the two-square pawn
  advance "since those speed-up rules are unnecessary here." Worth remembering: multi-move variants don't
  need the accelerants orthodox chess bolted on.

> **Adopt:** (i) Scottish rule — exposing the enemy King ends your turn; (ii) English-progressive rule — a
> piece may not generate a second bonus move in the same turn; (iii) Progressive's inaction draw, recounted
> in sub-moves; (iv) Bruce's balancing idea if we ever find a first-player skew.

### 1.4 Illegal capture / immunity / invulnerable pieces

- **Stratego Bomb** (above) — immunity with a guaranteed, over-supplied key, and a documented deadlock draw
  when the key is exhausted.
- **Ralph Betza, "Restrictions on Being Captured"**
  (<https://www.chessvariants.com/d.betza/pieceval/p7-05.html>) is the definitive warning:
  > "Imagine a game where White has only the King and an uncapturable Knight on g1. It's pretty obvious that
  > Black can win. Gradually give White more material, and you discover that **it's probably impossible to
  > get an even game** because either White wins by material advantage if he can defend his King long
  > enough, or Black wins quickly by checkmate."
  > "I think that an **Iron Ghost is worth five or ten times as much as a capturable Ghost** … Ghost equals
  > half a Pawn, Iron Ghost equals a Knight or Rook."
  > "(Actually, **if you have 6 or more Iron Ghosts, you can easily draw against the FIDE-chess army.**)"
  Uncapturability is worth 5–10× and six invulnerable blockers draw against a full army. Total immunity is
  the most dangerous single mechanic on our list.
- Betza also names the countervailing force, the **levelling effect**: strong pieces lose value against weak
  ones — "three queens badly lose to seven knights behind pawn walls"
  (<https://en.wikipedia.org/wiki/Chess_piece_relative_value>). Our mutual-destruction rule is a levelling
  effect amplifier.

Our saving grace, measured: **type immunity is naturally rare.** Over the 18×18 single-type chart there are
exactly **8 immune ordered pairs = 2.5%** of all matchups:
`Dragon→Fairy, Electric→Ground, Fighting→Ghost, Ghost→Normal, Ground→Flying, Normal→Ghost, Poison→Steel,
Psychic→Dark`. Each defending type is immune to at most **two** attacking types (Ghost). So no piece is ever
close to an Iron Ghost — a Flying piece is untouchable by Ground attackers only, i.e. by 1 of 18 possible
attacker types. Immunity is a local lockout, exactly like a Stratego Bomb, not global invulnerability.

### 1.5 King capture instead of checkmate: who does it, and why

Four independent families of variants replace checkmate with king-capture, and **in every case the reason is
that check is not reliably computable**:

| Variant | Rule | Source |
|---|---|---|
| **Fog of War Chess** (chess.com) | "players can see only the squares where their pieces can legally move"; the "crucial" departure is "the absence of checks or checkmates"; "The game only ends when one of the kings is **captured**." A king may legally step onto an attacked square; **stalemate is eliminated** — a king whose only moves are into attack "must do so and allow itself to be captured." | <https://www.chess.com/terms/fog-of-war-chess> |
| **Duck Chess** (Paulden 2016, chess.com) | "no checks or checkmates — players capture the enemy king to win." Kings "can move to attacked squares" and "can also castle through attacked squares." Being stalemated is a **win**. | <https://www.chess.com/terms/duck-chess> |
| **Losing Chess / Antichess** | "kings lose their royal powers … checks are no longer a threat"; the king "can be taken like any other piece"; "there is no check or checkmate"; pawns may promote to kings. Weakly **solved** by Mark Watkins, Oct 2016: 1.e3 wins for White. | <https://en.wikipedia.org/wiki/Losing_chess>, <https://lichess.org/variant/antichess> |
| **Single-die Dice Chess** (BrainKing) | "**There is no check or checkmate. Rather, the goal is to actually capture the king.**" | <https://en.wikipedia.org/wiki/Dice_chess> |
| **ICC Atomic** | "enforces no check whatsoever, making legal any move, even one leaving the king to be captured directly in the next move." | <https://en.wikipedia.org/wiki/Atomic_chess> |

The generalisation: **checkmate requires that the set of legal replies be knowable at the moment of
adjudication.** Fog of War breaks that with hidden information. Duck Chess breaks it because the duck can
create or resolve attacks after the move. **Our rules break it with randomness:** whether a defensive capture
resolves a check is a *random variable*, so "a legal move must not leave your King in check" is not a
well-formed predicate. That is the actual root cause of the video's bug — not sloppiness, an ill-posed rule.

Texture cost, honestly stated: king-capture removes stalemate as a drawing resource, changes basic endgame
theory (Wikipedia's ICC datum: K+R vs K becomes a forced win where it is a book draw under check-enforcing
Atomic), and lets a novice lose by walking into a capture. Mitigations in §5.

### 1.6 Piece asymmetry and drafting: what actually keeps drafted armies fair

**Chess960 / Fischer Random** (<https://en.wikipedia.org/wiki/Fischer_random_chess>) — the best *quantified*
result on randomised setups. Constraints: bishops on opposite colours, king between the rooks ⇒ 960
positions. Rationale, in Fischer's words, was to stop chess "degenerated down to memorization and
prearrangement" so players "rely on their skill and creativity."
**The numbers:** Stockfish 9 (Sesse) evaluated all 960 start positions at between **0.00 and +0.57**, mean
**+0.18** for White; **27 positions dead equal**; the standard array (SP 518) is **+0.22**, so the average
Chess960 position is about **18.2% more balanced than the traditional one**. **Chess18** exists specifically
to exclude "setups granting White a large advantage." Double Fischer Random (921,600 positions) "has more
potential for the positions to be unbalanced."

> **Adopt the Chess18 method:** generate candidate army pairings, evaluate them with our own engine, publish
> the eval, and **ban or handicap the outliers.** Randomised setup + screening is a shipped, measured answer.

**Betza's Chess with Different Armies** (1979; <https://en.wikipedia.org/wiki/Chess_with_different_armies>) —
the most important cautionary tale in this entire document. Four armies (Fabulous FIDEs, Colorbound
Clobberers, Nutty Knights, Remarkable Rookies), kings and pawns identical, "equal in strength but with
significantly different properties." Balance was judged **empirically, not by arithmetic** — "the article
gives no formal point-count system; Betza's approach was selection by play." Human master playtests at
release deemed them balanced. Then engines were pointed at it:
- 2010, Fairy-Max: both Clobberers and Nutty Knights beat the FIDEs — Nutters "by slightly more than a pawn."
- **2015, Fairy-Max, 400 games across all four armies: Rookies +62%, Nutters +19%, Clobberers −11%,
  FIDE −71%.** Rookies over Nutters by 3% with 2% statistical error, holding at >90% confidence.
- H. G. Muller observed that the Clobberers' army-level edge "was less than their individual piece values
  would suggest — implying **values don't simply add up**."
- Patches followed for decades (Knappen's Drunken Nights 2012, Busy Beaver 2015, Prime Minister 2016).

> **Conclusion for our draft:** a point-buy is a *usability* device and a first-order sanity filter. It is
> **not** a balance mechanism. Master-level human judgement of army balance was off by more than a pawn, and
> point sums are sub-additive. Any point-buy we ship must be calibrated by self-play and re-tuned, forever.

**Really Bad Chess** (Zach Gage 2016; <https://en.wikipedia.org/wiki/Really_Bad_Chess>) — each side gets one
king plus 15 randomly chosen pieces; rules otherwise unchanged; **armies are dealt "based on the player's
skill level"**, which replaces a difficulty menu — win more, get a worse relative army. Also: **no draws at
all.** A stalemated side loses; threefold repetition is unavailable. That is a legitimate design stance for a
variant where mutual annihilation makes draws common.

**Crazyhouse** (<https://en.wikipedia.org/wiki/Crazyhouse>) — captured pieces switch sides and can be
dropped. Two lessons: (i) no published piece-value system exists for it, which tells you how hard revaluation
under new rules is; (ii) GM Larry Kaufman's judgement that games "tend to be short" and "it is almost certain
that White has a forced win, although it would probably be too difficult to prove this." Mechanics that add
tempo and material recycling push variants toward first-player wins. **Also note for us: drops break the
piece-count monovariant in §4 — if we ever add Crazyhouse-style drops or piece-creating "evolutions", the
termination proof must be redone.**

**Shotgun King: The Final Checkmate** (<https://store.steampowered.com/app/1972440/>) — maximally asymmetric:
you are a lone king with a shotgun against a full army. The balancing device is the one worth stealing:
between floors you "choose between two random combinations of **one upgrade for you and one upgrade for the
other side**." **Every buff you take also buffs the opponent.** A clean way to make a draft escalate without
letting either side snowball.

**Musketeer Chess** — I could not verify its rules from a primary source (the Wikipedia entry redirects into
a truncated list; musketeerchess.net returned HTTP 429). **Not cited; do not rely on my recollection of it.**

---

## 2. Measured facts about *our* rules (not priors — computed here)

All from `/tmp/pkmn-probe/probe-variants-recon{3,4,5}.mjs` against `@pkmn/data` gen 9.

### 2.1 The single-type matchup chart

Gen-9 type list from `@pkmn/data` has **19** entries: the 18 real types **plus `Stellar`** (`???` is not in
the gen-9 list). **`Stellar` has 0 species and is neutral (1×) both ways against all 19 types** — as a
declarable draft type it would be a strictly-never-punished piece, so it must be excluded. See §7 surprises.

Over the **18×18 = 324** ordered (attacker, defender) pairs, one type each side:

| Outcome | Pairs | Share |
|---|---|---|
| 0× — capture illegal | 8 | **2.5%** |
| 0.5× — mutual destruction | 61 | **18.8%** |
| 1× — ordinary capture | 204 | **63.0%** |
| 2× — capture + bonus move | 51 | **15.7%** |

(With one type per side the multiplier can never be 4× or 0.25×; the extremes only appear if we ever allow
dual types.)

### 2.2 Per-type offence and defence — the draft's real value gradient

`OFF` columns count, over the 18 defender types: how many you hit for 2× / 0.5× / 0×.
`DEF` columns count, over the 18 attacker types: how many hit you for 2× / 0.5× / 0×.
`SAFE = DEF_0.5 + DEF_0` = number of attacker types that die with you or cannot touch you.

| Type | OFF 2× | OFF 0.5× | OFF 0× | DEF 2× | DEF 0.5× | DEF 0× | **SAFE** |
|---|---|---|---|---|---|---|---|
| **Steel** | 3 | 4 | 0 | 3 | **10** | 1 | **11** |
| Fire | 4 | 4 | 0 | 3 | 6 | 0 | 6 |
| Poison | 2 | 4 | 1 | 2 | 5 | 0 | 5 |
| Dragon | 1 | 1 | 1 | 3 | 4 | 0 | 4 |
| Fairy | 3 | 3 | 0 | 2 | 3 | 1 | 4 |
| Flying | 3 | 3 | 0 | 3 | 3 | 1 | 4 |
| Ghost | 2 | 1 | 1 | 2 | 2 | **2** | 4 |
| Grass | 3 | 7 | 0 | 5 | 4 | 0 | 4 |
| Rock | 4 | 3 | 0 | 5 | 4 | 0 | 4 |
| Water | 3 | 3 | 0 | 2 | 4 | 0 | 4 |
| Bug | 3 | 7 | 0 | 3 | 3 | 0 | 3 |
| Dark | 2 | 3 | 0 | 3 | 2 | 1 | 3 |
| Electric | 2 | 3 | 1 | 1 | 3 | 0 | 3 |
| **Fighting** | **5** | 5 | 1 | 3 | 3 | 0 | 3 |
| **Ground** | **5** | 2 | 1 | 3 | 2 | 1 | 3 |
| Psychic | 2 | 2 | 1 | 3 | 2 | 0 | 2 |
| Ice | 4 | 4 | 0 | 4 | 1 | 0 | **1** |
| Normal | **0** | 2 | 1 | 1 | 0 | 1 | **1** |

Readings:
- **Steel is broken-good defensively** — 11 of 18 attacker types either die attacking it or cannot. Under our
  rules that is close to Betza's Iron Ghost territory and it will be the single most contested draft resource.
- **Ground is the best attacker** (5 super-effective, only 2 self-destructive matchups) — the best
  offence/liability ratio on the board.
- **Ice and Normal are the most defenceless types** (SAFE = 1). This is the video's "my ice type is so
  worthless that the suicide is worth it", quantified. Normal additionally has **zero** super-effective
  matchups — a Normal piece can *never* earn a bonus move from typing. (But see §3.2: once offence is priced
  in, the two genuinely *worst* types are **Bug and Grass**, each with 7 self-destructive attacking matchups.)
- **Fighting** has the most 2× matchups (5) but pays for it with 5 self-destructive ones — a genuine
  high-variance type. Good design already present in the data.

### 2.3 Draft supply per type (733 standard base formes)

| Type | Species that can declare it | Type | Species |
|---|---|---|---|
| Water | 109 (14.9%) | Electric | 55 (7.5%) |
| Grass | 99 (13.5%) | Ghost | 50 (6.8%) |
| Normal | 77 (10.5%) | Fairy | 47 (6.4%) |
| Flying | 73 (10.0%) | Bug | 46 (6.3%) |
| Psychic | 72 (9.8%) | **Steel** | **43 (5.9%)** |
| Fire | 69 (9.4%) | Rock | 39 (5.3%) |
| Dragon / Ground | 60 each (8.2%) | **Ice** | **35 (4.8%)** |
| Fighting | 58 (7.9%) | | |
| Dark / Poison | 57 each (7.8%) | | |

The strongest defensive type (Steel, 43) and the weakest (Ice, 35) are the two scarcest. Scarcity plus power
means Steel must be a *rationed* draft resource, not just an expensive one.

### 2.4 The original ruleset, priced

Combining the d6 with the type chart exactly as the video specifies (6 = crit → bonus move regardless of
type; 1 = miss → both pieces die; otherwise type decides), for a legal capture attempt with a uniformly
random type pairing:

| Outcome | Probability |
|---|---|
| Capture + bonus move | **27.4%** |
| Mutual destruction (both die) | **29.5%** |
| Ordinary capture | **43.0%** |
| Attacker survives | 70.5% |
| **Defender removed** | **100%** |
| Pieces removed per capture | 1.295 |

**Two structural facts fall out.**

**(A) In the original rules a "miss" still kills the target.** Rule 4 says a 1 means "the attack fails and
both pieces die" — so the defender is removed even on a miss. Therefore *every legal capture removes the
defender, unconditionally.* There is no such thing as a failed attack. Attacking is never a gamble on
whether you gain material; it is only a gamble on whether you keep your own piece. That is almost certainly
not what was intended, and it is the largest single lever in the whole ruleset.

**(B) The value scale inverts.** Expected material delta for capturing a piece worth `v` with a piece worth
`u`, with `τ` = value of a free move (0.5 pawns used here):

`E[Δ] = v − 0.295·u + 0.274·τ`

| attacker ↓ / defender → | P (1) | N (3.2) | B (3.3) | R (5) | Q (9.5) |
|---|---|---|---|---|---|
| **P** (1) | +0.84 | +3.04 | +3.14 | +4.84 | +9.34 |
| **N** (3.2) | +0.19 | +2.39 | +2.49 | +4.19 | +8.69 |
| **B** (3.3) | +0.16 | +2.36 | +2.46 | +4.16 | +8.66 |
| **R** (5) | −0.34 | +1.86 | +1.96 | +3.66 | +8.16 |
| **Q** (9.5) | −1.67 | +0.53 | +0.63 | +2.33 | +6.83 |

Break-even defender value: a pawn profits from any target worth ≥ 0.16; a queen needs ≥ 2.67. **A queen
taking an *undefended* knight is worth only +0.53** (versus +3.2 in chess). High-value pieces stop being
attackers and become liabilities that cheap enemy pawns threaten for free — the Marseillais "the Queen's
value probably doesn't exceed two minor pieces" effect, arrived at independently and stronger.

**(C) The noise floor.** Standard deviation of material delta for a single capture, by attacker value:

| Attacker | P | N | B | R | Q |
|---|---|---|---|---|---|
| σ (pawns) | 0.58 | 1.56 | 1.61 | 2.38 | **4.43** |

With a realistic attacker mix (mostly pawns and minors, mean `u ≈ 2.5` ⇒ σ ≈ 1.3) and ~18 captures per game
(estimate: 30 non-King pieces at 1.295 removed per capture bounds a full board-clear at ~23 captures, and
games end before that — treat 18 as a mid-range assumption to be replaced by playtest telemetry),
**σ_dice ≈ 1.3 · √18 ≈ 5.5 pawns of purely random material swing per game.** For calibration, Stockfish's
whole first-move advantage in the standard array is +0.22 pawns. The dice as specified are ~25× the size of
the entire White advantage in chess. They do not "let the worse player win" — they decide the game.

---

## 3. Piece values under our rules — a proposed model

### 3.1 Base class values

Use a published set rather than the folk 1/3/3/5/9 (which "assume fixed movement and binary capture" and are
from the 18th-century Modenese school). Recommended base `m`: **P 1, N 3.2, B 3.3, R 5.0, Q 9.5**
(Berliner 1999 / AlphaZero 2020, from <https://en.wikipedia.org/wiki/Chess_piece_relative_value>: Berliner
3.20/3.33/5.10/8.80; AlphaZero 3.05/3.33/5.63/9.50). Keep Kaufman's phase adjustments as a v2 refinement
(middlegame P0.8 N3.2 B3.3 R4.7 Q—, endgame P1.0 N3.2 B3.3 R5.3) and the bishop-pair bonus (+0.3 mid → +0.5
endgame) only if we keep colour-bound bishops.

For any fairy pieces we add later, use Muller's short-range-leaper formula from the same page:
**value(centipawns) ≈ 33·N + 0.7·N²** for `N` distinct moves on 8×8, with "forward and capturing moves
counting roughly double"; and Betza's ideal-value shortcut
(<https://www.chessvariants.com/piececlopedia.dir/ideal-and-practical-values.html>): combine two half-knight
components ⇒ knight/bishop value, three ⇒ rook, five ⇒ queen.

### 3.2 The type term

Let `e(a,d)` be the multiplier. Under the recommended ruleset (§5: type is deterministic; the only dice are a
publicly-revealed crit rate `γ` and flinch rate `φ`), define per-attack outcome probabilities:

```
q_bonus(a,d)  = [e>1] + (1−[e>1])·γ          // super effective, or crit
q_death(a,d)  = [e=0.5]·(1−γ)                // mutual destruction, unless crit overrides
q_block(a,d)  = [e=0]                        // capture illegal
```

Let `ŵ_d` be the count-weighted share of enemy pieces with declared type `d` (uniform 1/18 for the draft
price list; live board composition for the AI eval). Define four per-type scalars:

```
LIAB(t)  = Σ_d ŵ_d · q_death(t,d)      // P(you die when you attack)      — "liability"
ARM(t)   = Σ_a ŵ_a · [q_death(a,t) + q_block(a,t)]   // P(an attacker dies or cannot come) — "armour"
BLOCK(t) = Σ_d ŵ_d · q_block(t,d)      // P(you cannot attack a given target)
BONUS(t) = Σ_d ŵ_d · q_bonus(t,d)      // P(you earn a free move when you attack)
```

**Value model:**

```
V(piece) = m · ( 1 − α·LIAB(t) + β·ARM(t) − ε·BLOCK(t) ) + τ · BONUS(t)
```

Rationale for the shape:
- `α·LIAB` and `β·ARM` **multiply `m`** — that is the whole point. What you risk when you attack, and what an
  attacker risks coming at you, both scale with how much piece is at stake. This single feature reproduces
  the queen collapse (§2.4B) and the Marseillais empirical finding, and it makes "Steel rook" and "Ice rook"
  genuinely different pieces.
- `τ·BONUS` is **additive** — a free move is worth the same tempo whoever earns it.
- `ε·BLOCK` is a small multiplicative penalty: a piece that cannot legally attack some enemy types is a
  worse attacker but not a worse blocker.

Starting coefficients, to be replaced by self-play regression: **α = 0.9, β = 0.5, ε = 0.3, τ = 0.5 pawns.**
`α < 1` because you *choose* when to attack; `β < α` because armour only helps when the opponent chooses to
come at you; `τ = 0.5` is bracketed below by Stockfish's +0.22 first-move advantage and above by the
Marseillais evidence that a single extra move at move 1 may be a theoretical win.

**The model evaluated on the real chart** (uniform `ŵ`, γ = 1/18, τ = 0.5, α/β/ε = 0.9/0.5/0.3 —
computed by `probe-variants-recon6.mjs`, sorted by rook value):

| Type | LIAB | ARM | BLOCK | BONUS | V(Pawn) | V(Knight) | V(Rook) | V(Queen) |
|---|---|---|---|---|---|---|---|---|
| **Steel** | 0.210 | **0.580** | 0.000 | 0.213 | 1.21 | 3.63 | **5.61** | **10.57** |
| Ghost | 0.052 | 0.216 | 0.056 | 0.160 | 1.12 | 3.42 | 5.30 | 10.00 |
| Dragon | 0.052 | 0.210 | 0.056 | 0.108 | 1.10 | 3.39 | 5.26 | 9.94 |
| Ground | 0.105 | 0.160 | 0.056 | **0.318** | 1.13 | 3.26 | 5.00 | 9.37 |
| Fire | 0.210 | 0.315 | 0.000 | 0.265 | 1.10 | 3.23 | 4.98 | 9.33 |
| Rock | 0.157 | 0.210 | 0.000 | 0.265 | 1.10 | 3.22 | 4.95 | 9.28 |
| Fairy | 0.157 | 0.213 | 0.000 | 0.213 | 1.07 | 3.19 | 4.93 | 9.27 |
| Flying | 0.157 | 0.213 | 0.000 | 0.213 | 1.07 | 3.19 | 4.93 | 9.27 |
| Water | 0.157 | 0.210 | 0.000 | 0.213 | 1.07 | 3.19 | 4.92 | 9.26 |
| Psychic | 0.105 | 0.105 | 0.056 | 0.160 | 1.02 | 3.09 | 4.79 | 9.02 |
| Dark | 0.157 | 0.160 | 0.000 | 0.160 | 1.02 | 3.08 | 4.77 | 9.00 |
| Poison | 0.210 | 0.262 | 0.056 | 0.160 | 1.01 | 3.04 | 4.71 | 8.87 |
| Electric | 0.157 | 0.157 | 0.056 | 0.160 | 1.00 | 3.03 | 4.68 | 8.82 |
| Normal | 0.105 | 0.056 | 0.056 | **0.056** | 0.94 | 2.96 | 4.61 | 8.74 |
| Ice | 0.210 | **0.052** | 0.000 | 0.265 | 0.97 | 2.81 | 4.32 | 8.09 |
| Fighting | 0.262 | 0.157 | 0.056 | **0.318** | 0.98 | 2.80 | 4.29 | 8.01 |
| Grass | **0.367** | 0.210 | 0.000 | 0.213 | 0.88 | 2.58 | 3.98 | 7.46 |
| Bug | **0.367** | 0.157 | 0.000 | 0.213 | 0.85 | 2.50 | 3.85 | 7.21 |

**Spread: 1.46× between the best and worst type of the same class** (Steel rook 5.61 vs Bug rook 3.85; Steel
queen 10.57 vs Bug queen 7.21; pawns 1.21 down to 0.85). That is the right magnitude — a Steel rook is worth
about a rook-and-a-half of a Bug rook, so type knowledge is worth real material, but a rook is still a rook.

Note the model corrects a naive reading of §2.2: **Bug and Grass are the worst types overall**, not Ice.
Both have **7** self-destructive attacking matchups, so their liability term dominates; Ice is a decent
attacker (4 super-effective) crippled only on defence (ARM = 0.052, the lowest on the board). "Worthless"
means different things offensively and defensively, and the formula separates them — which is exactly what a
draft price list needs.

### 3.3 How the draft and the AI share it

- **Draft point-buy:** `cost(piece) = round(4 · V(piece)) / 4` with uniform `ŵ`, i.e. quarter-pawn
  granularity, published on the card. Both sides get the same budget. Knightmare Chess's precedent lets us
  also offer a **voluntary handicap** (take a smaller budget) — a shipped commercial answer to skill gaps.
- **AI eval:** identical formula with live `ŵ`. Cost is trivial: `q_bonus/q_death/q_block` are three
  precomputed 18×18 byte tables; `LIAB/ARM/BLOCK/BONUS` are incrementally maintained as a per-side
  18-element type-count vector changes. O(1) per capture, no per-node loop over 18 types needed.
- **Never trust the sum.** Betza's armies were off by >1 pawn after master playtesting, and Muller measured
  that army value is **sub-additive**. Ship the point list as a *tool*, and gate actual army pairings through
  the Chess18 procedure: engine-evaluate candidate pairings, publish the eval, ban or handicap the tails.

---

## 4. Termination — formalised

### 4.1 The bonus-move chain terminates, with a bound of 16

**Definitions.** A *turn* by player `P` is a finite sequence of *sub-moves* `s₁ … s_L`. Sub-move `s₁` is the
ordinary move. For `k ≥ 1`, `s_{k+1}` exists **only if** `s_k` was a capture that removed at least one
opposing piece **and** the resolution granted a bonus move.

**Claim.** `L ≤ 1 + N`, where `N` is the number of opposing pieces on the board at the start of the turn.

**Proof.** Let `N_k` be the opponent's piece count after `s_k`. By the grant condition, `s_{k+1}` exists only
if `s_k` was a capture, and every capture removes the defender, so `N_k ≤ N_{k−1} − 1`. Hence for the chain
to reach length `L`, sub-moves `s₁ … s_{L−1}` must all be captures, requiring `N ≥ L − 1`, i.e.
`L ≤ N + 1`. `N ≤ 16` at all times (16 pieces per side, and no rule creates pieces), so **`L ≤ 17`, and
`L ≤ 16` once the enemy King is excluded as a capture target**. ∎

**Corollary (whole game).** Every bonus move is paid for by a distinct capture, and the total number of
captures in a game is at most 31 (each removes a piece; promotion transforms rather than creates). Therefore
**the total number of bonus sub-moves in a game is ≤ 31.** The mechanic cannot produce unbounded play. The
video's "infinite turns" worry is unfounded, and this is a monovariant argument, entirely independent of RNG.

**The two ways to break it — flag them loudly:**
1. **Granting a bonus move on a non-capture.** If any status effect, ability, item or "weather" grants an
   extra move without removing a piece, the monovariant is gone and termination must be re-proved (e.g. with
   an explicit per-turn counter).
2. **Any rule that adds pieces.** Crazyhouse-style drops, "summon", or an evolution that produces a second
   body. `N` must never increase.

### 4.2 The rule we ship anyway (for feel, not for termination)

`L ≤ 16` is *provably finite* and *experientially awful*: a 16-sub-move turn that ends with the enemy King
removed is a one-sided board wipe. Ship these three caps, each with prior art:

- **T1 — hard cap: `L ≤ 3`** (one ordinary move + at most two bonus moves). Chosen because measured chain
  probabilities under the *original* rules are `P(L≥3) = 7.5%`, `P(L≥5) = 0.57%`, `P(L≥8) = 0.012%` when
  every bonus move is itself a capture; the cap therefore binds only in the top few percent of turns while
  removing the whole tail. Under the recommended low-γ rules the cap almost never binds at all.
- **T2 — one bonus per piece per turn.** A piece that has already earned a bonus move cannot earn another in
  the same turn; the baton must pass to a different piece. Precedent: **English Progressive Chess** ("no
  piece may move twice until every other piece with a legal move has moved once … restrictions reset each
  turn"). This kills the "one super-typed piece mows the board" fantasy directly, and it makes a chain a
  *team* combo — a much better read on the board and a far better fit for Pokémon flavour.
- **T3 — exposing the enemy King ends your turn.** If after any sub-move the enemy King is capturable by any
  of your pieces, your turn ends immediately and remaining bonus moves are forfeit. Precedent: **Marseillais
  Chess** ("if a player gives check on his first move in a turn, he moves only once that turn") and
  **Scottish Progressive Chess** ("a check ends the series"). Beasley's 416-position study shows the
  cheaper Scottish form loses essentially nothing versus the strict Italian form.
  T3 is what makes the King-capture win condition safe: **the King can only ever be captured by the first
  sub-move of a turn**, from an exposure that was already on the board when the turn began. The opponent
  always gets a reply. This is the exact bug Marseillais patched 100 years ago.

### 4.3 Repetition, progress, and what a draw means

- **Threefold repetition** is claimed on `(piece placement, side to move, castling rights, en-passant
  target)` — **excluding the PRNG counter.** Engineering note that will bite if missed: our seeded PRNG
  advances monotonically, so if RNG state is part of the position key, repetition is *unreachable by
  construction* and the rule silently never fires.
- **Progress rule:** 100 consecutive **sub-moves** with no capture, no pawn move and no evolution ⇒ draw.
  This is the FIDE 50-move rule recounted in sub-moves; **Progressive Chess** sets the precedent for
  recounting the rule in a multi-move variant ("10 consecutive turns with no captures and no pawn moves
  draws, unless one of the players can force a checkmate").
- **Perpetual exposure ⇒ the exposing player loses.** Adopted from **shogi**: perpetual check "is an illegal
  move … which ends the game in a loss in tournament play" (<https://en.wikipedia.org/wiki/Shogi>). This
  closes the "chase forever with bonus-move tempo" degeneracy that a double-move mechanic otherwise creates.
- **No legal move ⇒ that player loses.** Under king-capture there is no such thing as being *forced* into
  check, so orthodox stalemate cannot arise; genuine total immobility should be a loss (shogi/xiangqi
  convention), *not* a draw and *not* a win. Rejecting the alternatives explicitly: **Progressive Chess**
  makes self-stalemate a drawing resource ("it is possible to save a draw by stalemating oneself") which is a
  degeneracy; **Duck Chess** makes being stalemated a *win*, which is bizarre; **Really Bad Chess** makes it
  a loss, which is right.
- **Mutual annihilation.** If both Kings are removed by one resolution, **the mover wins** (§5, R3). If both
  sides are reduced to lone Kings, **draw** — the precedent is Archon's "if the last piece on each side kills
  the other, the game is a draw."
- **Optional anti-draw tournament rule.** Mutual destruction will produce more drawn endgames than chess. Two
  shipped options: shogi's **jishōgi point count** (rook/bishop 5, everything else 1, "a player scoring fewer
  than 24 points loses"; both sides start with 27) as a material adjudication; or Really Bad Chess's
  **abolish draws entirely**. Recommend offering jishōgi-style material adjudication as a *ranked-ladder*
  setting only, and plain draws in casual play.

---

## 5. The check / King model — one coherent recommendation

**Recommendation: king-capture, no check-legality, with an Atomic-style suicide guard.**
Rule text, with the source of each clause.

> **R1 — Win condition.** A player wins the moment the opposing King is removed from the board, by any means
> (ordinary capture, mutual destruction, or any other effect). There is no checkmate terminal state.
> *[Fog of War Chess: "The game only ends when one of the kings is captured"; Duck Chess; Losing Chess;
> single-die Dice Chess: "There is no check or checkmate. Rather, the goal is to actually capture the king";
> ICC Atomic.]*
>
> **R2 — No check-legality.** A move that leaves your own King capturable is legal. A King may move to an
> attacked square. Castling through or out of attack is legal.
> *[Duck Chess: kings "can move to attacked squares" and "can also castle through attacked squares".]*
>
> **R3 — Suicide guard.** A move is **illegal** if, under the *deterministic* part of resolution, it
> necessarily removes your own King. A move that only *risks* your King (because a revealed die could go
> against you, or because the opponent may reply) is legal, and the UI must show the exact probability.
> *[Atomic rule 5 verbatim: "It is illegal to blow up your own King, even if that destroys the opponent King
> as well." Lichess: "It is illegal to capture a piece that would blow up your king."]*
>
> **R4 — Simultaneous royal death.** If one resolution removes both Kings, **the player who made the move
> wins.** Deaths are applied in a fixed order (defender, then attacker) and the game ends at the first
> moment a King leaves the board.
> *[Lichess Atomic: "any move that results in blowing up the opposite king will result in an immediate
> victory, overriding all checks and checkmates." Wikipedia's Atomic article notes the standard rules
> *prevent* rather than adjudicate this case; we adjudicate it, in favour of aggression, to remove the
> incentive to force mutual annihilation when losing.]*
>
> **R5 — Exposure ends the turn.** See T3 in §4.2. This is what guarantees the opponent a reply and prevents
> "expose the King with sub-move 1, take it with sub-move 2."
> *[Marseillais Chess; Scottish Progressive Chess.]*
>
> **R6 — Kings are never immune and never confer immunity.** A King's declared type is used for *its*
> attacks and for the multiplier when it is captured, but 0× never applies to a King as defender: it degrades
> to 0.5× (mutual destruction). *[Stratego's "always supply the key" principle — the Flag and the Marshal are
> never unreachable; the Miner outnumbers the Bomb 5 to 6.]*
>
> **R7 — Check is advice, not law.** The engine computes and displays, every turn: which of your pieces are
> capturable, by what, and with what probability; and specifically a persistent **"your King can be taken"**
> banner naming the attacker and the exact probability the capture succeeds. Checkmate-like positions are
> *labelled* ("your King cannot escape") but are not terminal.

### 5.1 Why this, and not "keep checkmate"

Because **checkmate is not a well-formed predicate under our rules.** Orthodox legality is "the resulting
position must not have your King attacked." Under mutual destruction with any randomness, the resulting
position is a *random variable*: whether a defensive capture removes the checking piece depends on a roll.
You cannot ask "is this move legal" without collapsing the distribution first, and if you collapse it you
have either (i) told the player the future, or (ii) made legality depend on a hidden roll — which is what
produced the on-camera bug ("your piece died in check… it's my turn").

Note the general law visible across the prior art: **every variant that makes check hard to compute switches
to king-capture.** Fog of War (hidden information), Duck Chess (post-move board mutation), ICC Atomic
(collateral), single-die Dice Chess (RNG). We are in the same family. This is not novel; it is the standard
resolution.

There is exactly one way to *keep* checkmate: **make capture resolution fully deterministic** (type chart
only, no dice at all). Then legality is decidable, Kamikaze Chess's 1928 mate-in-2 problems prove it works,
and the legality test is just "simulate the full resolution — including all deaths and only the *first*
sub-move — and require your King to be on the board and unattacked." That option is genuinely open and worth
prototyping as a "Classic" ruleset. But since we are keeping *some* randomness, R1–R7 is the coherent choice.

### 5.2 The six questions, answered explicitly

**(a) Capture while in check, with mutual destruction.** Legal. It is the defining tactic of Kamikaze Chess.
Resolution: your piece and the checker both die; the exposure evaporates unless the removal of your own piece
opens a new line. If it does, your King is now capturable and the opponent may take it next turn — that is a
consequence, not an illegality. The video's bug ("your piece died in check, it's my turn") becomes the
*correct* outcome under R2: the turn ends, the King is exposed, and the opponent wins on their move unless
you can prevent it — which you can't, because it is their turn. The player made a losing move. That is fine
and legible, and the R7 banner would have told them.

**(b) King capture vs checkmate.** King capture (R1). Trade-offs accepted: stalemate disappears as a drawing
resource, basic endgame theory shifts (Wikipedia's ICC Atomic datum: K+R vs K becomes a forced win where it
is a book draw under check-enforcing rules), and a careless novice can lose instantly. R7 plus an optional
"Guarded" accessibility mode (see §6.4) mitigate the last.

**(c) Can mutual destruction remove a checking piece?** **Yes**, and it should be a headline tactic. It is
the one defensive resource that a badly-typed cheap piece has, and it makes the video's "my Ice type is so
worthless that the suicide is worth it" an *intended* line rather than an exploit. Atomic already carves out
the analogous case: the general "you may not capture if the blast kills your own king" restriction has an
exception when the checked side "can win the game by exploding the checking player's king."

**(d) Is a move that would kill your own King legal?** **No if deterministic, yes if probabilistic** (R3).
This is Atomic rule 5 lifted verbatim, with the necessary extension for our RNG. The asymmetry is
deliberate: players should never be able to *accidentally* end the game, but they must be allowed to take a
calculated risk. The UI obligation is absolute — if a move has a non-zero chance of removing your own King,
the number must be on screen before the click.

**(e) Both Kings die in one exchange.** **The mover wins** (R4). Rationale: (i) it matches Lichess Atomic's
"blowing up the opposite king … overrides all checks and checkmates"; (ii) awarding a draw creates a
degenerate strategy — a losing player hunts for a mutual-annihilation line to salvage half a point, which is
exactly the kind of dominant single tactic Sirlin defines as an imbalance
(<http://www.sirlin.net/articles/balancing-multiplayer-games-part-1-definitions>: if an expert reliably wins
with one tactic, the game is imbalanced for lack of viable options); (iii) rewarding aggression keeps games
short and decisive, which is what a mutual-destruction game wants. Note this is a *choice* — Archon's
precedent goes the other way ("if the last piece on each side kills the other, the game is a draw"), but
Archon has no material race to protect.

**(f) Is suicide-capture a feature?**

*Against.* It compresses the value scale toward zero (§2.4B: a queen taking an undefended knight nets +0.53),
turns cheap badly-typed pieces into universal solvents, and destroys chess's central tactical grammar of
protection. Rifle Chess's one-line warning is the failure mode: "it is of no use to guard pieces." It also
makes the *lower* half of the draft matter more than the upper half, which inverts the drafting fantasy.

*For.* It is the most battle-tested mechanic on this entire list. Stratego has shipped "equal ranks, both are
removed" since 1942 and it is the source of most of its tension. Kamikaze Chess has been a composition and
tournament form since 1928. It is the mechanism by which a type-literate player converts *knowledge* into
*material* — the single most on-brief mechanic we have. And it is what makes a Magikarp meaningful.

**Verdict: keep it, and make it deterministic.** Specifically:
1. Mutual destruction happens **only** from the type chart (0.5×), never from a die. It is knowable,
   plannable, and *chosen*. This preserves protection (you can compute whether a trade is good) while keeping
   the tension.
2. Price it. The `α·LIAB·m` term in §3.2 means a queen with a bad offensive type is *correctly cheaper* to
   draft, so the draft absorbs the distortion instead of the board.
3. Bound the value compression by keeping the base spread large: with only 18.8% of matchups at 0.5×, the
   compression is ~19% of attacker value per attack, not ~30% as under the original dice rules.

---

## 6. The skill question — a variance budget and its knobs

### 6.1 What the premise actually requires

The concept's premise is "Pokémon type knowledge is the edge that lets you beat a better chess player." That
is a quantitative claim, so state it as a target and check it.

Model the decided outcome as a margin in pawns:
`M = D_chess + D_type + ε`, with `Var(M) = σ²_chess + σ²_type + σ²_dice`.

**σ_type — measured.** A type-literate player who attacks only at ≥1× and prefers 2× versus a type-blind
player who attacks at the chart's base rates gains, per capture, `Δ(P(self-death))·u + Δ(P(bonus))·τ`. Using
the measured among-legal-captures shares (0.5× = 19.3%, 2× = 16.1%), that upper bound is
`0.193·u + 0.161·τ`; at `u = 2.5, τ = 0.5` that is **≈0.56 pawns per capture**, or **≈10 pawns over an
18-capture game**. Type knowledge is enormous, and it is
*fully deterministic* — pure skill, no luck.

**σ_dice — measured.** Under the original rules, **≈5.5 pawns per game** (§2.4C). Under the recommended
rules (crit γ = flinch φ = 1/18, both revealed at turn start, no post-commitment roll), per-capture σ falls
to ≈0.25 pawns because (i) the stake shrinks from "your whole attacker" to "one tempo / one denied capture",
and (ii) revealing the state before the decision lets a good player route around the bad face — variance
that a player can plan around costs far less than its nominal size. **≈1.1 pawns per game.**

**σ_chess — assumed, and flagged as an assumption.** Take 1 pawn ≈ 70 Elo (range 50–100; no fetchable
primary source survived — Duersch, Lambrecht & Oechssler, "Measuring skill and chance in games", *European
Economic Review* 2020, DOI `10.1016/j.euroecorev.2020.103472`, is the right paper for a rigorous skill index
but is closed access and I could not verify its numbers). Then a 300-Elo chess-strength gap ≈ **4.3 pawns**.

**The headline consequence:** type mastery (≈10 pawns) is worth roughly **700 Elo of chess strength**. The
premise is satisfied *by the type chart alone*. The dice are not needed to let the worse chess player win —
they were the wrong tool for a job the type chart already does. That is the single most important finding in
this document.

### 6.2 Target shares, and why

| Component | σ (pawns) | Share of Var(M) | Rationale |
|---|---|---|---|
| Chess strength | ~4.3 (at 300 Elo spread) | **~45%** | It must still be chess. |
| Type knowledge | ~4.5 (population sd, not the max edge) | **~35%** | The stated design premise; must be learnable and deterministic. |
| RNG | ~2.0 | **~20%** | Enough to produce upsets and stories; not enough to overturn a two-class skill gap. |

The 20% RNG figure is a *design* target, chosen so that a single game is swingy but a 5-game match is not.
Note the recommended rules land at σ_dice ≈ 1.1 (≈7% of variance), i.e. **below** target — so there is
headroom to raise γ and φ from 1/18 toward 1/12 for feel. Tune upward from a safe floor rather than
downward from the video's 1/6.

**Betza's asymmetry principle is the real master dial**
(<https://www.chessvariants.com/d.betza/pieceval/p4-05.html>):
> "The weaker player in a game should choose an opening that produces a violent confrontation right out of
> the book moves, and try to play a short game. The stronger player should choose an opening that leads to a
> complex game, but in which the real fighting is delayed as long as possible; and is best served by playing
> a long and complex game."

Our game removes **1.295 pieces per capture** and hands out free moves — it is *structurally* short and
violent, which is *structurally* pro-underdog. Game length is the master dial: **fewer decisions ⇒ less chess
skill expressed.** If a build feels too luck-driven, the first thing to reach for is not the dice, it is
lengthening the game (lower mutual-destruction rate).

### 6.3 The knobs, in order of leverage

1. **Input vs output randomness — the single biggest lever (≈5× on σ_dice at equal rate).** Never roll after
   a player commits. Concretely: at the start of each turn, publicly reveal that turn's random state — e.g. a
   **CRIT type** (uniform over 18: any capture by a piece of that type is treated as ≥2× this turn) and a
   **FLINCH type** (uniform over 18: pieces of that type cannot capture this turn). Both players see both.
   Every dice-chess variant that survived does it this way ("may move pieces indicated on die or dice
   thrown"); Knightmare Chess and Pawnbarian deal cards then let you plan. The video's rule is the opposite,
   and it is why the RNG dominates.
2. **The mutual-destruction stake.** Full attacker loss makes σ ∝ `u` (hence the queen's 4.43). Alternatives
   that shrink σ dramatically while keeping the flavour: the attacker survives but is **demoted a class**;
   or the attacker survives with a **status** (`slp/par/brn` etc. — 5 non-volatile statuses exist in the
   data) that suppresses it for N turns; or the attacker is **bounced back to its origin square**. Prototype
   at least one of these.
3. **γ and φ (crit / flinch rate): 0 → 1/6.** σ_dice ∝ √γ. Recommend shipping at **1/18 each** and tuning up.
   Reject 1/6-with-full-attacker-loss outright.
4. **Immunity treatment.** 0× is naturally only **2.5%** of matchups, and each defending type is immune to at
   most 2 attacker types, so total invulnerability never arises — Betza's Iron Ghost catastrophe is not
   reachable from the real type chart. Keep 0× as a legal-move restriction; add R6 (Kings exempt). If
   playtesting shows lockouts feel unfair, the graceful degradation is **0× → "graze": the capture fails, no
   one dies, the attacker does not move** — which reduces immunity to zero without touching the type chart.
   Whatever we do, keep Stratego's rule: **always supply the key, and over-supply it.**
5. **Draft depth.** Zero freedom (fixed themed presets) → 6 picks → 16 picks → full 32. Calibration from
   prior art: Chess960's *randomised* setups span only 0.00 to +0.57 pawns (mean +0.18) and Chess18 still
   bans the tail; whereas *hand-designed* "equal" armies in CwDA came out at +62% / −71% score across 400
   engine games. **Free drafting is far more dangerous than randomisation.** Ship shallow (presets + 6 picks
   from curated pools) and deepen only behind measured pairing evals.
6. **Game length / attrition rate.** See above. Also the reason to consider the 10×10, two-kings idea from
   Dice Chess ("Adding two kings reduces the impact of chance and adds more strategic depth") — more royal
   targets means a single unlucky roll cannot end the game. This is the cleanest way to buy variance
   tolerance if we ever want the dice louder.
7. **Escalating draft à la Shotgun King** — every upgrade you take also upgrades the opponent. Good for a
   single-player roguelike mode; not for ranked.

### 6.4 Legibility mitigations for the king-capture model

Chess players will lose games to R2 until they adapt. Three cheap fixes, all with precedent:
- **R7's persistent "your King can be taken" banner**, naming the attacker and the probability. Fog of War
  and Duck Chess players learn this in a handful of games *without* any such aid; with the aid it should be
  a non-issue.
- **A "Guarded" mode** (casual / tutorial default) that filters out moves leaving your King capturable with
  probability ≥ p, restoring something close to check-legality without changing the win condition. Turn it
  off in ranked. Cost: two legality paths in the engine — accept it, it is a shared predicate with the AI's
  move generator anyway.
- **Chess960's rationale applies to us for free**: because the draft randomises the army, "gaining an
  advantage through the memorization of openings" is unfeasible, so a chess player's book knowledge is
  neutralised on both sides and the underdog's disadvantage shrinks before the type chart even applies.

---

## 7. Where prior art gives the answer, and what we invent

**Adopt outright (battle-tested; do not redesign):**

| Rule | Source |
|---|---|
| Mutual destruction on a bad matchup | Kamikaze Chess (1928); Stratego "equal ranks, both are removed" |
| Illegal to *deterministically* kill your own King | Atomic rule 5, verbatim |
| Mover wins if both Kings die at once | Lichess Atomic's "overrides all checks and checkmates" |
| King capture as the win condition, no check-legality | Fog of War, Duck Chess, Losing Chess, single-die Dice Chess |
| Exposing the enemy King ends your turn | Marseillais Chess; Scottish Progressive Chess |
| A piece may not earn a second bonus move in one turn | English Progressive Chess |
| Inaction draw, recounted in sub-moves | Progressive Chess (10-turn rule) |
| Perpetual exposure loses | Shogi's perpetual-check rule |
| No legal move ⇒ loss | Shogi / xiangqi convention (and Really Bad Chess) |
| Immunity must always have a key, over-supplied | Stratego Bomb / 5 Miners vs 6 Bombs |
| Roll before the decision, never after | every surviving dice-chess variant |
| Point-costed asymmetry with voluntary handicap | Knightmare Chess dueling decks |
| Screen and ban unbalanced pairings by engine eval | Chess960 / Chess18 |
| Difficulty by army quality, not by AI handicap | Really Bad Chess |
| Escalating symmetric upgrades (roguelike mode) | Shotgun King |
| Material adjudication instead of an endless draw | Shogi jishōgi 24/27-point count |

**We must invent (no prior art found):**
1. The **type-aware piece-value formula** in §3.2. Nothing in the literature values a piece by a
   rock-paper-scissors matchup term — Betza wrote the chapter heading ("Rock, Paper, Scissors") and
   explicitly left it unfinished, concluding only that "distance, dominations, and can-mate are the important
   factors."
2. **Probabilistic self-destruction being legal while deterministic self-destruction is illegal** (R3). Atomic
   has no RNG, so it never needed the distinction.
3. The **input-randomness scheme** (public per-turn CRIT/FLINCH types). The pattern is standard; this
   particular instantiation is ours.
4. The **draft supply rationing** implied by §2.3 (Steel is both scarcest and strongest).

---

## 8. Surprises and corrections

1. **The brief's type count is slightly wrong, in a way that matters.** It says "Types 19 (18 + `???`)".
   Measured: gen 9's type list has **19 entries = the 18 real types + `Stellar`**, and `???` is *not* in the
   gen-9 list. **`Stellar` has 0 species and is 1× against everything both ways** — as a declarable draft
   type it would be a piece that can never be mutual-destructed and can never be blocked, i.e. a strictly
   dominant defensive choice. It must be excluded from the draft, and the working chart is **18×18 = 324**
   pairs, not 19×19 = 361. (Probe: `probe-variants-recon2.mjs`, `probe-variants-recon3.mjs`.)
2. **"Infinite / runaway turns" is not actually a problem.** The brief lists it as needing "a provable
   termination bound"; the bound is one line and is 16 (§4.1). Every bonus move is paid for with a captured
   piece. What the mechanic really needs is a *cap for feel*, and a warning never to grant a bonus move on a
   non-capture.
3. **In the original rules a "miss" still kills the defender.** Rule 4 reads "the attack fails and both
   pieces die," so a capture *always* removes its target and there is no such thing as a failed attack. This
   is almost certainly unintended and it is the largest single lever in the ruleset.
4. **The dice invert the piece-value scale, not just add noise.** A queen taking an undefended knight nets
   only +0.53 pawns; a rook taking a pawn is **negative** (−0.34). Marseillais Chess independently reports
   the same effect from a double-move rule ("the Queen … probably doesn't exceed the value of two minor
   pieces"). Expect strong pieces to be *hidden*, not used, unless we fix this.
5. **Type immunity is far less dangerous than the brief fears, and Steel is far more dangerous than anyone
   mentioned.** 0× is 2.5% of matchups and never global. But Steel repels or kills **11 of 18** attacker
   types while being one of the two scarcest types in the dex (43 species) — that, not the Flying/Ground
   lockout, is the real "untouchable piece" problem.
6. **The "worthless type" isn't Ice.** Everyone's intuition (and the video's on-camera complaint) says Ice.
   Once offence is priced, **Bug and Grass are worse** — each has 7 of 18 attacking matchups at 0.5×, so a
   Bug or Grass piece self-destructs on more than a third of its attacks. Ice is a fine attacker (4
   super-effective matchups) with the worst defence on the board (ARM = 0.052). The draft price list must
   separate offence from defence or it will misprice half the roster.
7. **The concept's premise doesn't need dice at all.** Type knowledge is worth ~10 pawns/game ≈ 700 Elo of
   chess strength. The RNG was introduced to let the worse player win, and it turns out to be both unnecessary
   for that purpose and ~5× too loud.
8. **Hand-balancing asymmetric armies does not work.** Betza's four CwDA armies were pronounced balanced by
   human masters and, decades later, scored **+62% / +19% / −11% / −71%** over 400 engine games. Every design
   that ships drafted armies and cares about fairness ends up screening pairings by engine eval
   (Chess960/Chess18) or removing randomness entirely (Chess Evolved Online: "PvP-enabled units have zero RNG
   of any kind").
9. **A closed-access gap I could not fill:** Duersch/Lambrecht/Oechssler's *Measuring skill and chance in
   games* (EER 2020, DOI 10.1016/j.euroecorev.2020.103472) is the right rigorous skill/luck index for a
   post-launch measurement plan; it is paywalled and OpenAlex reports no open copy, so the pawn↔Elo constant
   in §6.1 is my modelling assumption, not a sourced figure. Once we have a ladder, measure it ourselves:
   fit `P(win)` against `(ΔElo_chess, Δtype-quiz-score)` and read the coefficients off.

---

## 9. Sources

Chess variant rules
- Atomic Chess (canonical DICS ruleset, 5 numbered rules) — <https://www.chessvariants.com/difftaking.dir/atomic.html>
- Atomic Chess (lichess rules, check override, connected kings) — <https://lichess.org/variant/atomic>
- Atomic Chess (atomic check, ICC vs FICS vs lichess divergence) — <https://en.wikipedia.org/wiki/Atomic_chess>
- Kamikaze / Hara-kiri Chess (Laws 1928; Pritchard; AISE; Kamikaze Progressive) — <https://www.chessvariants.com/difftaking.dir/kamikaze.html>
- Marseillais Chess (patches, balanced version, queen devaluation) — <https://en.wikipedia.org/wiki/Marseillais_chess> and <https://www.chessvariants.com/multimove.dir/marseill.html>
- Progressive Chess (Italian/Scottish, English, inaction draw, Beasley 2011) — <https://en.wikipedia.org/wiki/Progressive_chess>
- Dice Chess (two-dice, single-die "no check or checkmate", 10×10 two kings) — <https://en.wikipedia.org/wiki/Dice_chess>
- Rifle Chess (Seabrook 1921; "of no use to guard pieces") — <https://www.chessvariants.com/difftaking.dir/rifle.html>
- Duck Chess — <https://www.chess.com/terms/duck-chess>
- Fog of War Chess — <https://www.chess.com/terms/fog-of-war-chess>
- Losing Chess / Antichess (solved 2016) — <https://en.wikipedia.org/wiki/Losing_chess>, <https://lichess.org/variant/antichess>
- Three-check Chess (alternate win condition reshaping values) — <https://en.wikipedia.org/wiki/Three-check_chess>
- Crazyhouse — <https://en.wikipedia.org/wiki/Crazyhouse>
- Chess960 / Fischer Random (Sesse Stockfish 9 numbers, Chess18) — <https://en.wikipedia.org/wiki/Fischer_random_chess>
- Shogi (sennichite, perpetual check, jishōgi 24/27) — <https://en.wikipedia.org/wiki/Shogi>

Piece values and army balance
- Chess with Different Armies (Fairy-Max 2010/2015 results; Muller on sub-additivity) — <https://en.wikipedia.org/wiki/Chess_with_different_armies>
- Chess piece relative value (all systems; Kaufman phases; Muller leaper formula; levelling effect) — <https://en.wikipedia.org/wiki/Chess_piece_relative_value>
- Point Value (Shannon, Berliner, Kaufman, engine tables) — <https://www.chessprogramming.org/Point_Value>
- Betza, "About the Values of Chess Pieces" index — <https://www.chessvariants.com/d.betza/pieceval/index.html>
  - "Rock, Paper, Scissors" — <https://www.chessvariants.com/d.betza/pieceval/p7-04.html>
  - "Restrictions on Being Captured" (Iron Ghost) — <https://www.chessvariants.com/d.betza/pieceval/p7-05.html>
  - "Why an advantage affects the winning rate" — <https://www.chessvariants.com/d.betza/pieceval/p4-04.html>
  - "Why ELO ratings affect the winning rate" (short violent games favour the weaker player) — <https://www.chessvariants.com/d.betza/pieceval/p4-05.html>
  - "Random Ain't Chess" (limits of random-mobility values) — <https://www.chessvariants.com/d.betza/pieceval/p8-04.html>
- Betza, "Ideal and Practical Values" (part 1) — <https://www.chessvariants.com/piececlopedia.dir/ideal-and-practical-values.html>

Non-chess prior art
- Stratego (equal ranks, Bomb/Miner, Spy, deadlock draws) — <https://en.wikipedia.org/wiki/Stratego>
- Archon: The Light and the Dark (combat resolution, mutual elimination draw, power points) — <https://en.wikipedia.org/wiki/Archon:_The_Light_and_the_Dark>
- Knightmare Chess (point-costed decks, asterisk limits, handicapping) — <https://en.wikipedia.org/wiki/Knightmare_Chess>
- Really Bad Chess (skill-scaled random armies, no draws) — <https://en.wikipedia.org/wiki/Really_Bad_Chess>
- Chess Evolved Online (500+ units, custom armies, zero RNG in PvP) — <https://store.steampowered.com/app/1064340/>
- Pawnbarian (card hand as chess moves) — <https://store.steampowered.com/app/1142080/>
- Shotgun King (paired upgrade escalation) — <https://store.steampowered.com/app/1972440/>
- Sirlin, "Balancing Multiplayer Games, Part 1: Definitions" (viable options, fairness, degenerate strategies) — <http://www.sirlin.net/articles/balancing-multiplayer-games-part-1-definitions>

Not verified / do not rely on
- **Musketeer Chess** — no primary source reachable (Wikipedia redirect truncated; musketeerchess.net HTTP 429).
- **Duersch, Lambrecht & Oechssler, "Measuring skill and chance in games", *European Economic Review* 2020,
  DOI 10.1016/j.euroecorev.2020.103472** — exists (confirmed via Crossref) but closed access; OpenAlex reports
  no open copy. Cited as a pointer only; its numbers are **not** used here.

Measured on this machine (`/tmp/pkmn-probe`, `@pkmn/dex@0.10.11` + `@pkmn/data@0.10.11`, gen 9)
- `probe-variants-recon.mjs` — 19-type chart census, per-attacker/defender profiles
- `probe-variants-recon2.mjs` — type-list contents per generation; Stellar species count; mono/dual split (412 / 464)
- `probe-variants-recon3.mjs` — 18×18 chart distribution, the 8 immunities, the OFF/DEF/SAFE table
- `probe-variants-recon4.mjs` — original-ruleset outcome distribution, E[Δ] and σ tables, chain-length distribution
- `probe-variants-recon5.mjs` — per-type draft supply over 733 standard base formes
- `probe-variants-recon6.mjs` — the §3.2 value model evaluated for all 18 types × 5 classes
