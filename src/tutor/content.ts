/**
 * The authored lessons.
 *
 * Split from `lessons.ts` (the machinery) so the content reads as content: each row is a position, a
 * matchup, a goal, and the coaching beats. Type facts are all against `typechart.ts`; the four outcome
 * lessons use type-pinned movesets so the matchup they teach is the one that resolves (§18.3). The two
 * variance lessons carry a seed found by `lessons.test.ts`'s search, so the reveal lands as designed.
 *
 * Two kings sit in every position — quietly, out of the action — so each lesson is a well-formed game the
 * real engine runs unmodified. Tucking them in the corners keeps the mover's king safe, so guarded mode
 * never hides the move the lesson is about.
 */

import type { Lesson } from './lessons.ts';

// White's king and Black's king, parked far from the lesson's action so neither is ever in danger.
const KINGS = [
  { at: 'a1', side: 'white', cls: 'king', species: 'snorlax', type: 'Normal' },
  { at: 'h8', side: 'black', cls: 'king', species: 'snorlax', type: 'Normal' },
] as const;

export const LESSONS: readonly Lesson[] = [
  // -------------------------------------------------------------------------
  // Chess-player track — the three type heuristics, taught by causing them.
  // -------------------------------------------------------------------------
  {
    id: 'water-beats-fire',
    track: 'chess-player',
    title: 'Water puts out Fire',
    blurb: 'You know how the pieces move. Here is the one new axis: type. Take the Fire piece with your Water one.',
    turn: 'white',
    seed: 'water-fire',
    pieces: [
      ...KINGS,
      { at: 'd4', side: 'white', cls: 'rook', species: 'gyarados', type: 'Water', pin: 'Water' },
      { at: 'd6', side: 'black', cls: 'knight', species: 'growlithe', type: 'Fire' },
    ],
    allowFrom: ['d4'],
    goal: { kind: 'causeVerdict', verdict: 'advantage' },
    beats: [
      { on: 'enter', say: 'Water into Fire is super-effective — the board stamps it gold before you commit. Take the Fire knight.' },
      { on: 'advantage', say: 'WEAKNESS ×2. A super-effective knockout even lets you move again. The chart is the whole game on top of chess — and the board always tells you the answer first.' },
      { on: 'done', say: 'That is the entire idea: your type knowledge is your edge, and every reachable square is stamped with the outcome it would produce.' },
    ],
  },
  {
    id: 'nothing-hits-ghost',
    track: 'chess-player',
    title: 'Nothing touches a Ghost with Normal',
    blurb: 'One matchup reads like a bug the first time. Try to take the Ghost with your Normal piece.',
    turn: 'white',
    seed: 'ghost-normal',
    pieces: [
      ...KINGS,
      { at: 'd4', side: 'white', cls: 'rook', species: 'tauros', type: 'Normal', pin: 'Normal' },
      { at: 'd6', side: 'black', cls: 'bishop', species: 'gengar', type: 'Ghost' },
    ],
    allowFrom: ['d4'],
    goal: { kind: 'attemptBlocked' },
    beats: [
      { on: 'enter', say: 'Your rook is Normal, the enemy bishop is a Ghost. Pick your rook up and look at the dashed grey ring — then try to take it anyway.' },
      { on: 'blocked', say: 'Impossible — in the games too. Normal cannot touch Ghost, and nothing changes that. The dashed ring and its reason live on the board forever, not just in this lesson.' },
      { on: 'done', say: 'When a piece looks untouchable, it is telling you the truth. Reach it with a different type, or leave it be.' },
    ],
  },

  // -------------------------------------------------------------------------
  // Pokémon-player track — the six silhouettes move like chess pieces.
  // -------------------------------------------------------------------------
  {
    id: 'the-knight-leaps',
    track: 'pokemon-player',
    title: 'The knight leaps in an L',
    blurb: 'You know the type chart. Here is the geometry: the knight jumps two-and-one, over anything in the way.',
    turn: 'white',
    seed: 'knight-move',
    pieces: [
      ...KINGS,
      { at: 'd4', side: 'white', cls: 'knight', species: 'jolteon', type: 'Electric' },
      { at: 'd5', side: 'white', cls: 'pawn', species: 'pikachu', type: 'Electric' },
      { at: 'e4', side: 'white', cls: 'pawn', species: 'raichu', type: 'Electric' },
    ],
    allowFrom: ['d4'],
    goal: { kind: 'reachSquare', square: 'e6' },
    beats: [
      { on: 'enter', say: 'The knight is the only piece that jumps. Move it to the marked square — notice it clears the pieces beside it.' },
      { on: 'done', say: 'Two forward and one across: that L is the knight, and it is the one piece walls do not stop.' },
    ],
  },
  {
    id: 'the-bishop-slides',
    track: 'pokemon-player',
    title: 'The bishop slides on a diagonal',
    blurb: 'The bishop runs any distance along a diagonal — but never turns a corner. Slide it to the mark.',
    turn: 'white',
    seed: 'bishop-move',
    pieces: [
      ...KINGS,
      { at: 'c1', side: 'white', cls: 'bishop', species: 'alakazam', type: 'Psychic' },
    ],
    allowFrom: ['c1'],
    goal: { kind: 'reachSquare', square: 'h6' },
    beats: [
      { on: 'enter', say: 'A bishop stays on its colour, moving any distance along a diagonal. Slide it up to the far square.' },
      { on: 'done', say: 'One diagonal, any distance. A bishop only ever touches half the board — the squares of its own colour.' },
    ],
  },

  // -------------------------------------------------------------------------
  // Shared spine — the four capture outcomes, then variance, status, and the win.
  // -------------------------------------------------------------------------
  {
    id: 'capture-neutral',
    track: 'shared',
    title: 'A neutral capture',
    blurb: 'Every capture is a short exchange of blows. When neither type has an edge, it is an ordinary trade.',
    turn: 'white',
    seed: 'capture-neutral',
    pieces: [
      ...KINGS,
      { at: 'd4', side: 'white', cls: 'pawn', species: 'kangaskhan', type: 'Normal', pin: 'Normal' },
      { at: 'e5', side: 'black', cls: 'pawn', species: 'rattata', type: 'Normal' },
    ],
    allowFrom: ['d4'],
    goal: { kind: 'causeVerdict', verdict: 'capture' },
    beats: [
      { on: 'enter', say: 'Normal into Normal — neither type has an edge. Take the enemy pawn on the diagonal.' },
      { on: 'capture', say: 'A clean chess capture: one slash, the piece is gone. But look at your pawn — it took a scratch, and HP does not come back. Wounds are real.' },
      { on: 'done', say: 'That is the baseline. Everything else is what happens when the types are not even.' },
    ],
  },
  {
    id: 'advantage-bonus',
    track: 'shared',
    title: 'Super-effective — and move again',
    blurb: 'A super-effective knockout is the strongest thing in the game: it captures, and it grants a bonus move.',
    turn: 'white',
    seed: 'advantage-bonus',
    pieces: [
      ...KINGS,
      { at: 'd4', side: 'white', cls: 'bishop', species: 'machamp', type: 'Fighting', pin: 'Fighting' },
      { at: 'g7', side: 'black', cls: 'rook', species: 'geodude', type: 'Rock' },
      { at: 'b2', side: 'white', cls: 'pawn', species: 'machop', type: 'Fighting', pin: 'Fighting' },
    ],
    allowFrom: ['d4', 'b2'],
    goal: { kind: 'spendBonus' },
    beats: [
      { on: 'enter', say: 'Fighting into Rock is ×2. Take the Rock rook on the long diagonal — the square is gold, a super-effective knockout.' },
      { on: 'advantage', say: 'WEAKNESS ×2 — the board turned gold and you may move again. But a bonus move must be a DIFFERENT piece: move your pawn to finish the turn.' },
      { on: 'done', say: 'Super-effective knockouts chain your turn — one piece opens the door, another walks through it. That tempo wins games.' },
    ],
  },
  {
    id: 'rout-resisted',
    track: 'shared',
    title: 'Resisted — and you die for it',
    blurb: 'Attacking a type that resists you — and hits back hard — is how you lose a piece for nothing. The board warns you first.',
    turn: 'white',
    seed: 'rout-resisted',
    pieces: [
      ...KINGS,
      { at: 'd4', side: 'white', cls: 'pawn', species: 'bellsprout', type: 'Grass', pin: 'Grass' },
      { at: 'e5', side: 'black', cls: 'rook', species: 'arcanine', type: 'Fire' },
    ],
    allowFrom: ['d4'],
    goal: { kind: 'causeVerdict', verdict: 'rout' },
    beats: [
      { on: 'enter', say: 'A Fire rook, offered to your Grass pawn — a rook for a pawn. But it cuts both ways: Grass into Fire is ×0.5, and Fire into Grass is ×2. The square shows the shatter-back mark. Take it anyway, and watch.' },
      { on: 'rout', say: 'RESISTANCE. Your weak hit failed to knock it out — then it burned you back for double, and YOU died. The pawn is gone; the rook barely noticed. The board warned you with that shatter mark.' },
      { on: 'done', say: 'Never attack into a resistance unless the trade is truly worth it. A free-looking rook can be bait — especially one that answers your type with its own advantage.' },
    ],
  },
  {
    id: 'blocked-ghost',
    track: 'shared',
    title: 'The untouchable piece',
    blurb: 'The most surprising rule in the game, and the one that reads like a bug: some pieces you simply cannot touch.',
    turn: 'white',
    seed: 'blocked-ghost',
    pieces: [
      ...KINGS,
      { at: 'd4', side: 'white', cls: 'bishop', species: 'gengar', type: 'Ghost', pin: 'Ghost' },
      { at: 'f6', side: 'black', cls: 'pawn', species: 'bidoof', type: 'Normal' },
    ],
    allowFrom: ['d4'],
    goal: { kind: 'attemptBlocked' },
    beats: [
      { on: 'enter', say: 'Your Gengar is a Ghost; the enemy pawn is Normal. Pick Gengar up — the pawn gets a dashed grey ring — then try to take it.' },
      { on: 'blocked', say: 'Ghost cannot touch Normal. Not unlikely — impossible, exactly as in the games. This is the one rule that feels like a bug the first time. A real Gengar would reach for a Poison move instead; here it has none.' },
      { on: 'done', say: 'Immunity runs both ways in the chart, and the dashed ring always names the reason. Untouchable is information, not a glitch.' },
    ],
  },
  {
    id: 'miss-reveal',
    track: 'shared',
    title: 'Right read, wrong roll',
    blurb: 'You read the chart correctly and the forecast still says no. That is the point of showing it before you commit.',
    turn: 'white',
    seed: 'miss-reveal',
    pieces: [
      ...KINGS,
      { at: 'd4', side: 'white', cls: 'rook', species: 'hariyama', type: 'Fighting', pin: 'Fighting' },
      { at: 'd6', side: 'black', cls: 'rook', species: 'aggron', type: 'Rock' },
      { at: 'b2', side: 'white', cls: 'pawn', species: 'diglett', type: 'Ground', pin: 'Ground' },
    ],
    allowFrom: ['d4', 'b2'],
    goal: { kind: 'heedMiss' },
    beats: [
      { on: 'enter', say: 'Fighting into Rock is ×2 — the trade you were just taught to seek. But pick your Fighting pawn up and read the forecast on the rook: this turn it will only REPEL. The bounce mark, not a gold star.' },
      { on: 'done', say: 'You read the chart right and the reveal still said no — the rook is too bulky to fall this turn. A miss you can SEE is not bad luck, it is a plan. So you did something else instead.' },
    ],
  },
  {
    id: 'crit-reveal',
    track: 'shared',
    title: 'A critical hit rescues you',
    blurb: 'The mirror of the miss: sometimes the reveal hands you a knockout you had no right to.',
    turn: 'white',
    seed: 'crit-ursaring-20',
    pieces: [
      ...KINGS,
      { at: 'd4', side: 'white', cls: 'knight', species: 'tauros', type: 'Normal', pin: 'Normal' },
      { at: 'e6', side: 'black', cls: 'bishop', species: 'ursaring', type: 'Normal' },
    ],
    allowFrom: ['d4'],
    goal: { kind: 'critRescue' },
    beats: [
      { on: 'enter', say: 'A neutral matchup into a bulky defender — normally your hit would just bounce off, a REPEL. But this turn the Focus coins came up all heads: a critical hit. Take it.' },
      { on: 'capture', say: 'Four heads — a critical hit ignored the defence and took the piece your ordinary blow would have bounced off. A crit rescues; it never hands you a free bonus move.' },
      { on: 'done', say: 'Momentum, crits and misses are all shown before you choose. Variance here is a mechanic you plan around, not a game that cheats.' },
    ],
  },
  {
    id: 'status-poison',
    track: 'shared',
    title: 'A wound that keeps working',
    blurb: 'Some moves leave a mark that ticks every turn. Poison is a slow death clock a bulky piece cannot ignore.',
    turn: 'white',
    seed: 'status-poison',
    pieces: [
      ...KINGS,
      { at: 'd4', side: 'white', cls: 'bishop', species: 'muk', type: 'Poison', pin: 'Poison', rider: 'poisoned' },
      { at: 'd6', side: 'black', cls: 'rook', species: 'steelix', type: 'Steel' },
    ],
    allowFrom: ['d4'],
    goal: { kind: 'applyStatus' },
    beats: [
      { on: 'enter', say: 'Poison into Steel is ×0.5 — you will not knock this rook out. But your attack still lands a poison mark. Attack it and look for the purple pip.' },
      { on: 'repel', say: 'The attack bounced — but a purple pip now sits under the rook. Poison adds a counter every turn and removes the piece at three, no matter how bulky it is.' },
      { on: 'rout', say: 'You did not survive the exchange — but you left a purple poison pip behind. Poison adds a counter every turn and removes the piece at three.' },
      { on: 'done', say: 'Status turns a piece you cannot capture into one that is already dying. Chip, poison, and wait.' },
    ],
  },
  {
    id: 'king-capture',
    track: 'shared',
    title: 'Win by taking the king',
    blurb: 'There is no checkmate here. You win the instant you capture the enemy king — and a king is never immune.',
    turn: 'white',
    seed: 'king-capture',
    pieces: [
      { at: 'a1', side: 'white', cls: 'king', species: 'snorlax', type: 'Normal' },
      { at: 'e5', side: 'white', cls: 'queen', species: 'dragonite', type: 'Dragon', pin: 'Dragon' },
      { at: 'e8', side: 'black', cls: 'king', species: 'gengar', type: 'Ghost' },
    ],
    allowFrom: ['e5'],
    goal: { kind: 'captureKing' },
    beats: [
      { on: 'enter', say: 'The enemy king is a Ghost — but a king is never untouchable (that is the one exception). Your queen has the file. Take the king and win.' },
      { on: 'done', say: 'That is the whole win condition: no checkmate, no stalemate to argue about — capture the king and the game is yours.' },
    ],
  },
];
