/**
 * The batch simulator — how balance is measured rather than argued (SPEC §19, DIRECTION).
 *
 * A maximalist game with 1025 species and a whole move/type layer cannot be balanced by intuition; the
 * only honest lever is to run many games headlessly and read the outcome frequencies. Because the engine
 * is pure, deterministic and seeded, a run is perfectly reproducible: the same config and seed produce the
 * same games every time, so a balance claim ("a mono-type army sits ~100 Elo behind") is a number this
 * module can produce and a test can assert, not a vibe.
 *
 * It is deliberately transport-free: `runBatch` is a plain function over the engine and the AI, usable
 * from a test, a CLI, or the Sandbox screen (which chunks it so the browser stays responsive).
 */

import type { Dex } from '../data/dex.ts';
import { PokemonChess } from '../engine/variant.ts';
import type { Loadout, Side } from '../engine/variant.ts';
import type { Position } from '../engine/position.ts';
import { chooseMove } from '../ai/search.ts';
import type { Difficulty } from '../ai/search.ts';
import { autodraft } from '../game/autodraft.ts';

export type GameWinner = Side | 'draw';

export interface GameOutcome {
  readonly winner: GameWinner;
  /** Total sub-moves played (a super-effective chain counts each). */
  readonly plies: number;
  readonly reason: 'king-capture' | 'fifty-move' | 'repetition' | 'no-legal-move' | 'ply-cap';
}

export interface BatchConfig {
  readonly games: number;
  readonly white: Difficulty;
  readonly black: Difficulty;
  /** Base seed; each game derives a distinct seed from it, so a run is reproducible. */
  readonly seed: string;
  /**
   * How the armies are drafted each game. `fresh` re-drafts both sides per game (varied); `fixed` reuses
   * one drafted position for every game (isolates AI strength from draft luck).
   */
  readonly draft?: 'fresh' | 'fixed';
  /** Hard cap on sub-moves before a game is called a draw, so a pathological line cannot hang a run. */
  readonly maxPlies?: number;
}

export interface BatchReport {
  readonly games: number;
  readonly whiteWins: number;
  readonly blackWins: number;
  readonly draws: number;
  /** White's score share, (wins + ½·draws) / games — 0.5 is even. */
  readonly whiteScore: number;
  readonly avgPlies: number;
  /** Games that hit the ply cap without a decision. */
  readonly capped: number;
}

const DEFAULT_MAX_PLIES = 400;

/** A small, stable string→int hash (FNV-1a) for deriving a numeric AI seed from a string. */
function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Plays one full AI-vs-AI game to its end (or the ply cap) and reports the outcome. */
export function simulateGame(
  dex: Dex,
  setup: { position: Position; loadout: Loadout },
  white: Difficulty,
  black: Difficulty,
  seed: string,
  maxPlies = DEFAULT_MAX_PLIES,
): GameOutcome {
  let game = PokemonChess.create({ dex, position: setup.position, loadout: setup.loadout, seed });
  let plies = 0;

  while (!game.isOver() && plies < maxPlies) {
    const difficulty = game.turn === 'white' ? white : black;
    // A per-ply seed keeps each decision reproducible and distinct across games and plies.
    const choice = chooseMove(game, difficulty, hashSeed(`${seed}:${plies}`));
    if (!choice) break;
    const target = game.legalMoves().find((m) => m.move.encoded === choice.move.encoded);
    if (!target) break;
    game = game.play(target.move).game;
    plies += 1;
  }

  const result = game.result();
  if (result.kind === 'win') return { winner: result.winner, plies, reason: 'king-capture' };
  if (result.kind === 'draw') return { winner: 'draw', plies, reason: result.reason };
  return { winner: 'draw', plies, reason: 'ply-cap' };
}

/**
 * Runs a batch and aggregates the outcomes.
 *
 * `onProgress` is called after each game with the number completed, so a UI can show a progress bar; it is
 * optional so a test or CLI ignores it.
 */
export function runBatch(dex: Dex, config: BatchConfig, onProgress?: (done: number, total: number) => void): BatchReport {
  const maxPlies = config.maxPlies ?? DEFAULT_MAX_PLIES;
  const fixed = config.draft === 'fixed' ? autodraft(dex, `${config.seed}:board`) : null;

  let whiteWins = 0;
  let blackWins = 0;
  let draws = 0;
  let capped = 0;
  let totalPlies = 0;

  for (let i = 0; i < config.games; i++) {
    const gameSeed = `${config.seed}:${i}`;
    const setup = fixed ?? autodraft(dex, gameSeed);
    const outcome = simulateGame(dex, setup, config.white, config.black, gameSeed, maxPlies);
    if (outcome.winner === 'white') whiteWins += 1;
    else if (outcome.winner === 'black') blackWins += 1;
    else draws += 1;
    if (outcome.reason === 'ply-cap') capped += 1;
    totalPlies += outcome.plies;
    onProgress?.(i + 1, config.games);
  }

  const games = config.games;
  return {
    games,
    whiteWins,
    blackWins,
    draws,
    whiteScore: games > 0 ? (whiteWins + draws * 0.5) / games : 0,
    avgPlies: games > 0 ? totalPlies / games : 0,
    capped,
  };
}
