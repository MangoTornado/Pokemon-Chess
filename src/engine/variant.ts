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
 * On top of that, every capture attempt rolls a six-sided die: a **1 misses** and destroys both pieces
 * anyway, and a **6 is a critical hit** that captures and grants the extra move regardless of type. The
 * die is not a gimmick bolted onto Pokémon — the trading card game resolves a great deal through coin
 * flips, so randomness on an attack is how the Pokémon board game already works.
 *
 * ## Status: provisional
 *
 * This implements the four rules from the source video plus the die, which is the concept's core and is
 * not expected to change. It deliberately does **not** yet implement moves, abilities, items, status,
 * hazards, weather or evolution; those await the full specification being written in `docs/design/`.
 * The decisions marked "PROVISIONAL" below are the ones that specification is expected to revisit.
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
export type ResolutionCause = 'type' | 'critical-hit' | 'miss';

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
  /** The die result, or null when nothing was being captured and so nothing was rolled. */
  readonly roll: number | null;
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
  /** Whether a 1 misses and destroys both pieces, and a 6 captures and grants an extra move. */
  readonly diceEnabled: boolean;
}

export const DEFAULT_RULES: VariantRules = {
  maxExtraMovesPerTurn: 2,
  diceEnabled: true,
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
   * 2. **A capture that could cost you your own king is not offered.** Because a not-very-effective
   *    capture destroys the attacker too, and because a 1 does the same on any roll, a capture that
   *    removes one of your own defenders can expose your king. Legality is therefore evaluated against
   *    the *worst* resolution rather than the expected one — see {@link captureIsSafe}.
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
   * PROVISIONAL, and the most consequential open decision in this module.
   *
   * The source video hit this bug on camera: a player's piece died capturing while their own king was in
   * check, and the turn ended with the king still in check. The trouble is that mutual destruction can
   * remove one of your own defenders, and with the die in play *any* capture can become mutual
   * destruction, so whether a move is legal cannot depend on a roll that has not happened yet.
   *
   * This resolves it conservatively: a capture is legal only if the mover's king is safe both when the
   * capture succeeds and when both pieces die. You therefore can never lose your king to a dice roll,
   * and the illegal position the video reached is unreachable. The alternative — allow the capture and
   * let a bad roll lose the game — is more faithful to the video's spirit but makes the die able to end
   * a game outright, which reads as unfair rather than exciting.
   */
  private captureIsSafe(move: Move, outcome: CaptureOutcome): boolean {
    const mover = this.position.pieceAt(move.from);
    if (!mover) return false;

    // Mutual destruction is only reachable two ways: a resisted matchup always causes it, and with the
    // die in play a 1 causes it on any capture. When neither applies the attacker cannot die here, so
    // chess legality has already settled the question.
    const mutualPossible = this.rules.diceEnabled || outcome === 'resisted';
    if (!mutualPossible) return true;

    // A king that trades itself away has simply lost, so it may never enter a trade it could lose.
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
        roll: null,
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
    const roll = this.rules.diceEnabled ? rng.d6() : null;

    let resolution: Resolution;
    let cause: ResolutionCause;
    if (roll === 1) {
      resolution = 'mutual-destruction';
      cause = 'miss';
    } else if (roll === 6) {
      resolution = 'capture-and-continue';
      cause = 'critical-hit';
    } else if (typeOutcome === 'resisted') {
      resolution = 'mutual-destruction';
      cause = 'type';
    } else if (typeOutcome === 'super') {
      resolution = 'capture-and-continue';
      cause = 'type';
    } else {
      resolution = 'capture';
      cause = 'type';
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
      roll,
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
