/**
 * The Pokémon Chess rules layer.
 *
 * Standard chess decides where a piece may *go*; this module decides what happens when it *arrives*.
 * That is the whole game. Every piece fights as exactly one Pokémon type, and the type matchup splits
 * the single chess notion of "capture" into four outcomes, which reprices every square on the board:
 *
 * | Multiplier | Outcome              | Consequence                                          |
 * |------------|----------------------|------------------------------------------------------|
 * | `0`        | no effect            | the capture is **illegal** and is never offered       |
 * | `< 1`      | not very effective   | **both** pieces are destroyed                        |
 * | `1`        | neutral              | an ordinary chess capture                            |
 * | `> 1`      | super effective      | the capture succeeds and the piece **moves again**    |
 *
 * Randomness sits on top, but only where it belongs. **The capture outcome itself is deterministic**: the
 * type chart decides it and the player can see the verdict before committing. What is random is the
 * *bonus* — after a plain capture, four coins are flipped, and four heads is a critical hit that grants
 * the extra move anyway.
 *
 * That split is not a compromise, it is what the measurements demanded. `recon-tcg.md` counted every
 * attack in the current Scarlet & Violet card era: of 4 435 attacks, only **0.8%** let a coin decide
 * whether the attack does anything at all, and 91.7% of all flips gate a *rider* rather than the outcome.
 * Independently, `recon-variants.md` measured the source video's d6 — where a 1 destroys both pieces — at
 * roughly **5.5 pawns of pure noise per game, about 25× the entire first-move advantage in chess**. The
 * conclusion both reached:
 *
 * > Output randomness is fine when the stake is a rider. It is catastrophic when the stake is a piece.
 *
 * So the die's "1 misses and both die" rule is gone. A coin may hand you extra tempo; it may never take
 * your piece. The probability alphabet is powers of one half, never sixths, because that is the only
 * randomiser the Pokémon board game uses — 1/16 is presented to the player as "four heads", not as 6.25%.
 *
 * ## Status: provisional
 *
 * This implements the four capture outcomes, which are the concept's core and are not expected to change,
 * plus the critical-hit flip. It deliberately does **not** yet implement moves, abilities, items, status,
 * hazards, weather or evolution; those await the full specification being written in `docs/design/`.
 *
 * Purity is preserved: no DOM, no I/O, no ambient randomness. A game is fully determined by its seed
 * plus its action list, which is what makes replays, server-authoritative validation and AI search
 * possible at all.
 */

import type { BattleType } from '../data/schema.ts';
import type { PieceClass, Side, Square } from './board.ts';
import { Position } from './position.ts';
import type { Move, Piece } from './position.ts';
import { Rng } from './rng.ts';
import type { RngState } from './rng.ts';
import { captureOutcome, effectiveness } from './typechart.ts';
import type { CaptureOutcome } from './typechart.ts';

// ---------------------------------------------------------------------------
// Loadouts
// ---------------------------------------------------------------------------

/**
 * The Pokémon standing in a chess piece's shoes.
 *
 * `type` is a single type even for a dual-typed species, because that is the draft decision the source
 * video made central: Lapras taken as Water is a different piece from Lapras taken as Ice, and which one
 * you chose determines what it can and cannot capture.
 */
export interface PokemonLoadout {
  /** Species id, as in `species.json`. */
  readonly species: string;
  /** The single type this piece fights as. */
  readonly type: BattleType;
}

/**
 * Loadouts keyed by the chess piece's persistent id.
 *
 * Keyed by id rather than by square because ids survive movement and promotion — a promoting pawn keeps
 * its id and changes class, which is exactly the shape evolution needs.
 */
export type Loadout = ReadonlyMap<number, PokemonLoadout>;

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

/** Why a capture resolved the way it did. Kept distinct from the outcome so the UI can explain it. */
export type ResolutionCause = 'type' | 'critical-hit';

/**
 * A critical-hit flip: a run of coins where every head is needed.
 *
 * Expressed as coins rather than a probability because the player should watch coins land rather than be
 * asked to trust a percentage, and because powers of one half are the only randomiser the Pokémon board
 * game uses.
 */
export interface CritFlip {
  /** Each flip in order; `true` is heads. */
  readonly coins: readonly boolean[];
  /** True only when every coin came up heads. */
  readonly isCrit: boolean;
}

export type Resolution =
  /** A move that captured nothing. */
  | 'quiet'
  /** The target was removed and the attacker took the square. */
  | 'capture'
  /** The target was removed, the attacker took the square, and may move again. */
  | 'capture-and-continue'
  /** Both pieces were removed. */
  | 'mutual-destruction';

/** A legal action, with everything the UI needs to explain it before it is taken. */
export interface VariantMove {
  readonly move: Move;
  readonly attacker: PokemonLoadout;
  /** Null for a move that captures nothing. */
  readonly defender: PokemonLoadout | null;
  /** Type multiplier against the defender, or null when nothing is being captured. */
  readonly multiplier: number | null;
  /** The type-chart verdict, or null when nothing is being captured. */
  readonly outcome: CaptureOutcome | null;
  /**
   * True when this action must be played by the piece that just captured.
   *
   * Extra moves belong to a specific piece, not merely to the side, which is what makes a
   * super-effective capture feel like the piece pressing its advantage.
   */
  readonly isExtraMove: boolean;
}

/** What actually happened, once the dice were rolled. */
export interface ResolvedMove {
  readonly move: Move;
  readonly side: Side;
  readonly attacker: PokemonLoadout;
  readonly defender: PokemonLoadout | null;
  readonly multiplier: number | null;
  readonly typeOutcome: CaptureOutcome | null;
  /**
   * The critical-hit flip, or null when none was made.
   *
   * Only a capture that already succeeded on type and did *not* already grant a bonus move flips for a
   * crit, since a crit has nothing to add to a super-effective capture and nothing to offer a capture that
   * destroyed the attacker.
   */
  readonly crit: CritFlip | null;
  readonly resolution: Resolution;
  readonly cause: ResolutionCause | null;
  /** True when the attacking piece was destroyed along with its target. */
  readonly attackerDestroyed: boolean;
  /** True when the same piece may now move again. */
  readonly grantsExtraMove: boolean;
  /** Ids removed from the board by this action. */
  readonly removed: readonly number[];
}

export type GameResult =
  | { readonly kind: 'playing' }
  | { readonly kind: 'checkmate'; readonly winner: Side }
  | { readonly kind: 'stalemate' }
  | { readonly kind: 'draw'; readonly reason: 'fifty-move' | 'repetition' | 'insufficient-material' };

// ---------------------------------------------------------------------------
// Rules configuration
// ---------------------------------------------------------------------------

export interface VariantRules {
  /**
   * How many extra moves one turn may chain.
   *
   * `DIRECTION.md` requires a proven termination bound, and this is it. Without a cap, a side holding a
   * type advantage could chain super-effective captures for as long as targets remain, and with the die
   * able to grant an extra move on any capture the chain has no natural end. Two extra moves means a
   * turn is at most three actions, and since every action in a chain must be a capture and each capture
   * removes at least one piece, a chain is bounded by the enemy piece count regardless.
   */
  readonly maxExtraMovesPerTurn: number;
  /**
   * Coins flipped after a plain capture; all heads grants a bonus move. Zero disables critical hits.
   *
   * Four coins is 1/16. That figure is not arbitrary: `recon-variants.md` derived a target critical rate
   * band of [1/18, 1/12] from a variance budget, and `recon-tcg.md` found four-coin effects printed on real
   * cards, so 1/16 is the only power of one half inside the band.
   */
  readonly critCoins: number;
}

export const DEFAULT_RULES: VariantRules = {
  maxExtraMovesPerTurn: 2,
  critCoins: 4,
};

// ---------------------------------------------------------------------------
// The game
// ---------------------------------------------------------------------------

interface PendingExtraMove {
  readonly side: Side;
  readonly pieceId: number;
  readonly used: number;
}

/**
 * A game of Pokémon Chess.
 *
 * Immutable-by-convention: {@link PokemonChess.play} returns a new game rather than mutating, so the
 * whole history is retained for replay, undo and network transmission. Positions are cloned per action,
 * which is cheap at the scale of a played game; AI search will use the mutable
 * `makeMove`/`unmakeMove` path on `Position` directly instead.
 */
export class PokemonChess {
  private constructor(
    readonly position: Position,
    readonly loadout: Loadout,
    readonly rules: VariantRules,
    private readonly rngState: RngState,
    private readonly pending: PendingExtraMove | null,
    readonly history: readonly ResolvedMove[],
  ) {}

  static create(options: {
    position?: Position;
    loadout: Loadout;
    seed: string | number;
    rules?: VariantRules;
  }): PokemonChess {
    const position = options.position ?? Position.fromStartingPosition();
    return new PokemonChess(
      position,
      options.loadout,
      options.rules ?? DEFAULT_RULES,
      new Rng(options.seed).state,
      null,
      [],
    );
  }

  get turn(): Side {
    return this.position.turn;
  }

  /** The piece obliged to move again, if a capture just granted an extra move. */
  get extraMovePieceId(): number | null {
    return this.pending?.pieceId ?? null;
  }

  /** How many extra moves the current turn has already consumed. */
  get extraMovesUsed(): number {
    return this.pending?.used ?? 0;
  }

  loadoutOf(pieceId: number): PokemonLoadout {
    const entry = this.loadout.get(pieceId);
    if (!entry) throw new Error(`no Pokémon assigned to piece ${pieceId}`);
    return entry;
  }

  // -------------------------------------------------------------------------
  // Legality
  // -------------------------------------------------------------------------

  /**
   * Every action the side to move may take.
   *
   * Starts from chess legality and then removes what the type chart forbids. Two filters matter:
   *
   * 1. **A 0× capture is not offered at all.** Ground genuinely cannot take Flying, so the target is
   *    untouchable by that piece — this is the rule that makes type knowledge positional rather than
   *    merely tactical.
   * 2. **A resisted capture that would expose your own king is not offered.** A not-very-effective capture
   *    destroys the attacker as well, so trading away one of your own defenders can leave your king in
   *    check — see {@link captureIsSafe}.
   */
  legalMoves(): VariantMove[] {
    const pending = this.pending;
    const out: VariantMove[] = [];

    for (const move of this.position.generateMoves()) {
      // An extra move belongs to the piece that earned it, so no other piece may act.
      if (pending) {
        const mover = this.position.pieceAt(move.from);
        if (!mover || mover.id !== pending.pieceId) continue;
      }

      // A king may never be captured.
      //
      // Ordinary chess never has to say this: you cannot be on move while the enemy king stands
      // attacked, because that position is unreachable. The extra move breaks that guarantee — the
      // capturing side moves twice, so after the first move the opponent's king may be in check with no
      // chance to answer, and the second move could simply take it. That is precisely the incoherence the
      // source video fell into when a player took a king outright on a critical hit.
      //
      // Forbidding the capture keeps checkmate as the single win condition: a check delivered mid-chain
      // is a check the opponent must still answer, merely one that arrived with extra tempo behind it.
      if (move.captured?.cls === 'king') continue;

      const attacker = this.loadoutOf(this.pieceIdAt(move.from));

      if (!move.captured) {
        out.push({
          move,
          attacker,
          defender: null,
          multiplier: null,
          outcome: null,
          isExtraMove: pending !== null,
        });
        continue;
      }

      const defender = this.loadoutOf(move.captured.id);
      const multiplier = effectiveness(attacker.type, defender.type);
      const outcome = captureOutcome(attacker.type, defender.type);

      // Rule 1: the type chart forbids this capture outright.
      if (outcome === 'immune') continue;

      // Rule 2: never offer a capture that a bad resolution could turn into losing your own king.
      if (!this.captureIsSafe(move, outcome)) continue;

      out.push({
        move,
        attacker,
        defender,
        multiplier,
        outcome,
        isExtraMove: pending !== null,
      });
    }

    return out;
  }

  /**
   * Whether a capture is safe under every resolution it could have.
   *
   * The source video hit this bug on camera: a player's piece died capturing while their own king was in
   * check, and the turn ended with the king still in check. Mutual destruction can remove one of your own
   * defenders, so a capture can expose your king even where chess calls the move legal.
   *
   * Making the capture outcome deterministic is what lets this be answered cleanly. Mutual destruction now
   * happens exactly when the matchup is resisted, and the player can see that before committing, so
   * legality is a fact about the position rather than a bet on a roll that has not happened. A resisted
   * capture is legal only if the mover's king is safe once the attacker is gone; every other capture is
   * already settled by chess legality.
   *
   * Under the video's die, where any capture could kill the attacker, this filter had to apply to *every*
   * capture — which also meant a king could never capture anything at all. That ugly consequence
   * disappears along with the die.
   */
  private captureIsSafe(move: Move, outcome: CaptureOutcome): boolean {
    const mover = this.position.pieceAt(move.from);
    if (!mover) return false;

    // Only a resisted matchup destroys the attacker, so nothing else can expose the king.
    if (outcome !== 'resisted') return true;

    // A king that trades itself away has simply lost, so it may never enter a trade it loses.
    if (mover.cls === 'king') return false;

    // The capture-succeeds branch is guaranteed safe already: chess legality established it. The
    // mutual-destruction branch is the same position with the attacker gone from the square it just
    // moved to, which is exactly what `isAttackedIgnoring` describes.
    const after = this.position.withMove(move);
    const king = after.kingSquare(mover.side);
    const enemy: Side = mover.side === 'white' ? 'black' : 'white';
    return !after.isAttackedIgnoring(king, enemy, move.to);
  }

  private pieceIdAt(square: Square): number {
    const piece = this.position.pieceAt(square);
    if (!piece) throw new Error(`no piece on ${square}`);
    return piece.id;
  }

  // -------------------------------------------------------------------------
  // Resolution
  // -------------------------------------------------------------------------

  /**
   * Plays an action, rolling the die if it is a capture, and returns the resulting game.
   *
   * The die is rolled from the game's own serialised RNG state, so the same seed and action list always
   * produce the same game — the property the server needs to validate a client's claims and the AI
   * needs to search reproducibly.
   */
  play(move: Move): { game: PokemonChess; resolved: ResolvedMove } {
    const mover = this.position.pieceAt(move.from);
    if (!mover) throw new Error(`no piece on ${move.from}`);

    const side = mover.side;
    const attacker = this.loadoutOf(mover.id);
    const rng = new Rng(this.rngState);

    if (!move.captured) {
      const resolved: ResolvedMove = {
        move,
        side,
        attacker,
        defender: null,
        multiplier: null,
        typeOutcome: null,
        crit: null,
        resolution: 'quiet',
        cause: null,
        attackerDestroyed: false,
        grantsExtraMove: false,
        removed: [],
      };
      return {
        game: new PokemonChess(
          this.position.withMove(move),
          this.loadout,
          this.rules,
          rng.state,
          null,
          [...this.history, resolved],
        ),
        resolved,
      };
    }

    const defenderPiece: Piece = move.captured;
    const defender = this.loadoutOf(defenderPiece.id);
    const multiplier = effectiveness(attacker.type, defender.type);
    const typeOutcome = captureOutcome(attacker.type, defender.type);

    if (typeOutcome === 'immune') {
      throw new Error(
        `${attacker.type} cannot capture ${defender.type}: the type chart forbids it outright`,
      );
    }

    // The die is rolled before the type chart is consulted, because a 1 or a 6 overrides it.
    // The type chart alone decides the outcome, so the player already knew this before committing.
    let resolution: Resolution =
      typeOutcome === 'resisted'
        ? 'mutual-destruction'
        : typeOutcome === 'super'
          ? 'capture-and-continue'
          : 'capture';
    let cause: ResolutionCause = 'type';

    // Only a plain capture flips for a critical hit: a super-effective capture is already continuing, and
    // a crit has nothing to offer a capture that destroyed the attacker. The stake is tempo, never a
    // piece, which is the whole reason this flip is allowed to happen after the player has committed.
    let crit: CritFlip | null = null;
    if (resolution === 'capture' && this.rules.critCoins > 0) {
      const coins: boolean[] = [];
      for (let i = 0; i < this.rules.critCoins; i++) coins.push(rng.chance(50));
      const isCrit = coins.every((head) => head);
      crit = { coins, isCrit };
      if (isCrit) {
        resolution = 'capture-and-continue';
        cause = 'critical-hit';
      }
    }

    const used = this.pending?.used ?? 0;
    // A chain that has run out of allowance still captures; it simply stops there.
    if (resolution === 'capture-and-continue' && used >= this.rules.maxExtraMovesPerTurn) {
      resolution = 'capture';
    }

    const attackerDestroyed = resolution === 'mutual-destruction';
    const removed = attackerDestroyed
      ? [defenderPiece.id, mover.id]
      : [defenderPiece.id];

    let next = this.position.withMove(move);
    if (attackerDestroyed) {
      next = next.withPieceRemoved(move.to);
    }

    let pending: PendingExtraMove | null = null;
    if (resolution === 'capture-and-continue') {
      const continued = next.withTurnReturned();
      // Grant the extra move only if the piece can actually use it, so a turn never stalls waiting for
      // a move that does not exist.
      const canContinue = continued
        .generateMoves()
        .some((m) => continued.pieceAt(m.from)?.id === mover.id);
      if (canContinue) {
        next = continued;
        pending = { side, pieceId: mover.id, used: used + 1 };
      } else {
        resolution = 'capture';
      }
    }

    const resolved: ResolvedMove = {
      move,
      side,
      attacker,
      defender,
      multiplier,
      typeOutcome,
      crit,
      resolution,
      cause,
      attackerDestroyed,
      grantsExtraMove: pending !== null,
      removed,
    };

    return {
      game: new PokemonChess(next, this.loadout, this.rules, rng.state, pending, [
        ...this.history,
        resolved,
      ]),
      resolved,
    };
  }

  // -------------------------------------------------------------------------
  // Result
  // -------------------------------------------------------------------------

  /**
   * The game's status.
   *
   * PROVISIONAL on one point. The video ended a game by taking a king outright on a critical hit, which
   * contradicts checkmate. Here checkmate stands, and king capture is unreachable by construction:
   * chess legality already forbids moving into check, and {@link captureIsSafe} forbids a king from
   * trading itself away. So the winner is decided the way chess decides it.
   */
  result(): GameResult {
    if (this.legalMoves().length > 0) {
      if (this.position.isFiftyMoveDraw()) return { kind: 'draw', reason: 'fifty-move' };
      if (this.position.isThreefoldRepetition()) return { kind: 'draw', reason: 'repetition' };
      if (this.position.isInsufficientMaterial()) {
        return { kind: 'draw', reason: 'insufficient-material' };
      }
      return { kind: 'playing' };
    }

    // No legal action. In standard chess that is mate or stalemate by whether the king is attacked;
    // here it can additionally arise because every capture available was type-forbidden, which is a
    // genuine positional bind rather than a bug.
    if (this.position.isInCheck()) {
      return { kind: 'checkmate', winner: this.turn === 'white' ? 'black' : 'white' };
    }
    return { kind: 'stalemate' };
  }

  /** True when no further action is possible. */
  isOver(): boolean {
    return this.result().kind !== 'playing';
  }

  /** Piece classes with their Pokémon, for rendering. */
  pieces(): { square: Square; piece: Piece; pokemon: PokemonLoadout; cls: PieceClass }[] {
    return this.position.allPieces().map(({ square, piece }) => ({
      square,
      piece,
      cls: piece.cls,
      pokemon: this.loadoutOf(piece.id),
    }));
  }
}
