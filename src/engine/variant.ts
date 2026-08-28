/**
 * The Pokémon Chess rules layer — real HP, the Clash, and king capture.
 *
 * Standard chess (`position.ts`) decides where a piece may go; this decides what happens when it arrives.
 * Every piece is a level-50 Pokémon with real hit points, and a capture is a **Clash**: a bounded
 * exchange of blows in Speed order (`clash.ts`), classified into five outcomes that realise the video's
 * four rules —
 *
 * | Verdict     | Defender | Attacker | Square | Bonus | Video rule |
 * |-------------|----------|----------|--------|-------|------------|
 * | `advantage` | removed  | survives | attacker's | **yes** | super-effective → move again |
 * | `capture`   | removed  | survives, often wounded | attacker's | no | neutral → ordinary capture |
 * | `mutual`    | removed  | removed  | empty  | no | both pieces removed |
 * | `rout`      | survives, wounded | removed | defender's | no | a failed assault |
 * | `repel`     | survives | survives, returns to origin | defender's | no | the miss / bounce |
 *
 * plus `blocked`: a 0× matchup that is never offered at all.
 *
 * The win condition is **king capture** (the Regicide rule), not checkmate. Checkmate is not a well-formed
 * predicate here — whether a piece "attacks" the king depends on type legality and on randomness not yet
 * drawn — so you win by actually removing the enemy king in a Clash. See SPEC §4, §5, §12.
 *
 * Provisional scope: this resolves the melee Clash (slot 0, the piece's declared type), which is the
 * video's core and the default line of play. Coverage moves, abilities, items, status, hazards, weather
 * and evolution await the content compiler; the Clash and damage layers already take the modifier inputs
 * those will supply, so wiring them is additive.
 *
 * Purity is preserved: the RNG state is threaded through game state, so a game is fully determined by its
 * seed and its action list — the property replay, server validation and AI search require.
 */

import type { BattleType, SpeciesEntry } from '../data/schema.ts';
import type { Dex } from '../data/dex.ts';
import type { PieceClass, Side, Square } from './board.ts';
import { Position } from './position.ts';
import type { Move, Piece } from './position.ts';
import { Rng } from './rng.ts';
import type { RngState } from './rng.ts';
import { effectiveness } from './typechart.ts';
import { resolveClash } from '../rules/clash.ts';
import type { ClashRoll, ClashVerdict, Combatant } from '../rules/clash.ts';
import type { DamageInput } from '../rules/damage.ts';
import { computeStats } from '../rules/stats.ts';
import type { PieceStats } from '../rules/stats.ts';

// ---------------------------------------------------------------------------
// Loadouts and live state
// ---------------------------------------------------------------------------

/** The Pokémon in a chess piece's shoes, and the single type it fights and defends as. */
export interface PokemonLoadout {
  readonly species: string;
  readonly type: BattleType;
}

/** Loadouts keyed by the chess piece's persistent id, which survives movement and promotion. */
export type Loadout = ReadonlyMap<number, PokemonLoadout>;

/** A piece's live hit points, tracked apart from the loadout because it changes as the game runs. */
export interface LiveState {
  readonly hp: number;
  readonly maxHp: number;
  /** True until the piece has taken any damage — gates survive-once effects. */
  readonly pristine: boolean;
}

// ---------------------------------------------------------------------------
// Move previews and results
// ---------------------------------------------------------------------------

/** The full verdict vocabulary, including the never-offered case, for the UI and forecasts. */
export type Verdict = ClashVerdict | 'quiet' | 'blocked';

/**
 * A legal action, with a forecast of what a capture would do at representative luck.
 *
 * The forecast is computed at Momentum 100 with no crit — the plain reading a player should default to.
 * The true odds across all 16 Momentum values are available on demand for the "your king can be taken"
 * banner, but the previewed verdict is what colours the board.
 */
export interface VariantMove {
  readonly move: Move;
  readonly attacker: PokemonLoadout;
  readonly defender: PokemonLoadout | null;
  /** Type multiplier of the attacker's declared type against the defender, or null for a quiet move. */
  readonly effectiveness: number | null;
  /** Forecast verdict at representative luck, or `quiet` for a non-capture. */
  readonly forecast: Verdict;
  /** True when this action must be played by the piece that just earned a bonus move. */
  readonly isExtraMove: boolean;
}

export interface ResolvedMove {
  readonly move: Move;
  readonly side: Side;
  readonly attacker: PokemonLoadout;
  readonly defender: PokemonLoadout | null;
  readonly effectiveness: number | null;
  readonly verdict: Verdict;
  /** HP left on attacker and defender after the Clash (0 = removed). */
  readonly attackerHpAfter: number;
  readonly defenderHpAfter: number;
  readonly attackerMaxHp: number;
  readonly defenderMaxHp: number | null;
  /** The Clash roll that resolved it, for the UI to replay the drama. */
  readonly crit: boolean;
  readonly momentum: number;
  readonly blowCount: number;
  readonly grantsBonus: boolean;
  /** Ids removed from the board. */
  readonly removed: readonly number[];
  /** True when a king was among the removed — the game-ending event. */
  readonly kingCaptured: boolean;
}

export type GameResult =
  | { readonly kind: 'playing' }
  | { readonly kind: 'win'; readonly winner: Side; readonly by: 'king-capture' }
  | { readonly kind: 'draw'; readonly reason: 'fifty-move' | 'repetition' | 'no-legal-move' };

// ---------------------------------------------------------------------------
// Rules configuration
// ---------------------------------------------------------------------------

export interface VariantRules {
  /**
   * Extra moves one turn may chain, bounding termination.
   *
   * Independently bounded anyway: every action in a chain must be a capture and every capture removes a
   * piece, so a chain cannot outlive the enemy army. The cap is for feel, not for termination.
   */
  readonly maxExtraMovesPerTurn: number;
  /**
   * Coins flipped for a critical hit; all heads is a ×1.5-damage crit on the attacker's first swing.
   *
   * Four coins is 1/16, the rate the variance budget asked for and a real TCG four-coin effect. A crit
   * is a damage bonus, not an automatic bonus move — the bonus move comes only from a super-effective
   * knockout (ADVANTAGE), which is the video's actual rule.
   */
  readonly critCoins: number;
  /**
   * Guarded mode: hide actions that leave your own king capturable at representative luck.
   *
   * The casual and tutorial default. It is a filter over the legal actions, never a second generator, so
   * the same predicate serves the AI; and it never empties the list — if every action is risky it shows
   * them all with the warning standing, because a UI that offers nothing reads as a crash. Off in rated
   * play, where check is advice (R8) and the banner does the warning instead.
   */
  readonly guarded: boolean;
}

export const DEFAULT_RULES: VariantRules = {
  maxExtraMovesPerTurn: 2,
  critCoins: 4,
  guarded: true,
};

// ---------------------------------------------------------------------------
// The game
// ---------------------------------------------------------------------------

interface PendingExtraMove {
  readonly side: Side;
  readonly pieceId: number;
  readonly used: number;
}

const MELEE_BASE_POWER = 80;

export class PokemonChess {
  private constructor(
    readonly position: Position,
    readonly loadout: Loadout,
    readonly rules: VariantRules,
    /** Battle stats per piece id, computed once — pieces do not change species mid-game (yet). */
    private readonly stats: ReadonlyMap<number, PieceStats>,
    /** Live HP per piece id. Absent means full HP (never damaged), so a fresh game stores nothing. */
    private readonly live: ReadonlyMap<number, LiveState>,
    private readonly rngState: RngState,
    private readonly pending: PendingExtraMove | null,
    readonly history: readonly ResolvedMove[],
  ) {}

  static create(options: {
    dex: Dex;
    position?: Position;
    loadout: Loadout;
    seed: string | number;
    rules?: VariantRules;
  }): PokemonChess {
    const position = options.position ?? Position.fromStartingPosition();
    const stats = new Map<number, PieceStats>();
    for (const { piece } of position.allPieces()) {
      const entry = options.loadout.get(piece.id);
      if (!entry) throw new Error(`no Pokémon assigned to piece ${piece.id}`);
      const species = options.dex.getSpecies(entry.species);
      if (!species) throw new Error(`unknown species ${entry.species}`);
      stats.set(piece.id, computeStats(species));
    }
    return new PokemonChess(
      position,
      options.loadout,
      options.rules ?? DEFAULT_RULES,
      stats,
      new Map(),
      new Rng(options.seed).state,
      null,
      [],
    );
  }

  get turn(): Side {
    return this.position.turn;
  }

  get extraMovePieceId(): number | null {
    return this.pending?.pieceId ?? null;
  }

  get extraMovesUsed(): number {
    return this.pending?.used ?? 0;
  }

  loadoutOf(pieceId: number): PokemonLoadout {
    const entry = this.loadout.get(pieceId);
    if (!entry) throw new Error(`no Pokémon assigned to piece ${pieceId}`);
    return entry;
  }

  statsOf(pieceId: number): PieceStats {
    const s = this.stats.get(pieceId);
    if (!s) throw new Error(`no stats for piece ${pieceId}`);
    return s;
  }

  /** Live HP state for a piece, defaulting to full HP for one never yet damaged. */
  liveOf(pieceId: number): LiveState {
    const existing = this.live.get(pieceId);
    if (existing) return existing;
    const stats = this.statsOf(pieceId);
    return { hp: stats.maxHp, maxHp: stats.maxHp, pristine: true };
  }

  // -------------------------------------------------------------------------
  // Effectiveness, with the king rule
  // -------------------------------------------------------------------------

  /**
   * The attacker's type multiplier against a defender, with R6 applied.
   *
   * A king is never immune as a defender: a 0× reads as exactly 1×, so a king can always be attacked.
   * That closes the untouchable-king exploit (a Ghost king a Normal army could never threaten).
   */
  private multiplierAgainst(attackerType: BattleType, defenderId: number): number {
    const defender = this.loadoutOf(defenderId);
    const raw = effectiveness(attackerType, defender.type);
    const piece = this.pieceById(defenderId);
    if (piece?.cls === 'king' && raw === 0) return 1;
    return raw;
  }

  private pieceById(id: number): Piece | null {
    for (const { piece } of this.position.allPieces()) {
      if (piece.id === id) return piece;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Legality
  // -------------------------------------------------------------------------

  /**
   * Every action the side to move may take, each with a capture forecast.
   *
   * Chess legality first, then two filters. A 0× capture is `blocked` and never offered (except against a
   * king, per R6). In guarded mode, an action that leaves your own king capturable at representative luck
   * is hidden — unless hiding it would empty the list, in which case everything is shown and the banner
   * warns instead.
   */
  legalMoves(): VariantMove[] {
    const all = this.rawMoves();
    if (!this.rules.guarded) return all;

    const safe = all.filter((m) => !this.leavesOwnKingCapturable(m.move));
    // Never offer nothing: a filtered-empty list degrades to the full list with the banner standing.
    return safe.length > 0 ? safe : all;
  }

  /** Legal actions before the guarded-mode filter. The AI and the banner share this. */
  rawMoves(): VariantMove[] {
    // A captured king ends the game, so a kingless board offers nothing.
    if (this.kingRemoved('white') || this.kingRemoved('black')) return [];
    const pending = this.pending;
    const out: VariantMove[] = [];

    for (const move of this.position.generateMoves()) {
      // An extra move belongs to the piece that earned it.
      if (pending) {
        const mover = this.position.pieceAt(move.from);
        if (!mover || mover.id !== pending.pieceId) continue;
      }

      const moverPiece = this.position.pieceAt(move.from)!;
      const attacker = this.loadoutOf(moverPiece.id);

      if (!move.captured) {
        out.push({
          move,
          attacker,
          defender: null,
          effectiveness: null,
          forecast: 'quiet',
          isExtraMove: pending !== null,
        });
        continue;
      }

      const defenderId = move.captured.id;
      const mult = this.multiplierAgainst(attacker.type, defenderId);
      if (mult === 0) continue; // BLOCKED — never offered (never reached for a king, per R6).

      out.push({
        move,
        attacker,
        defender: this.loadoutOf(defenderId),
        effectiveness: mult,
        forecast: this.forecastVerdict(move),
        isExtraMove: pending !== null,
      });
    }

    return out;
  }

  /** Whether making this move leaves the mover's king capturable by the opponent at representative luck. */
  private leavesOwnKingCapturable(move: Move): boolean {
    const mover = this.position.pieceAt(move.from);
    if (!mover) return false;
    const side = mover.side;

    // Resolve the move on a scratch game at representative luck, then ask whether the opponent has a
    // capture of our king that would succeed.
    const after = this.applyResolved(move, { hits: true, crit: false, momentum: 100 }).game;
    if (after.kingRemoved(side)) return true; // our own move removed our king → certainly bad

    const enemy: Side = side === 'white' ? 'black' : 'white';
    if (after.turn !== enemy) {
      // We still have the move (a bonus). A king exposed to ourselves is not the enemy's to take.
      return false;
    }
    return after.rawMoves().some((m) => {
      if (!m.move.captured) return false;
      const target = m.move.captured;
      if (target.cls !== 'king' || target.side !== side) return false;
      const v = after.forecastVerdict(m.move);
      return v === 'advantage' || v === 'capture' || v === 'mutual';
    });
  }

  private kingRemoved(side: Side): boolean {
    return this.position.allPieces().every(({ piece }) => !(piece.side === side && piece.cls === 'king'));
  }

  // -------------------------------------------------------------------------
  // Clash setup and resolution
  // -------------------------------------------------------------------------

  /**
   * Builds the two damage inputs for a Clash.
   *
   * The attacker strikes with its declared type (slot 0, the melee slot); the defender counters with its
   * own declared type. STAB always applies on slot 0, because attacking with your own type is the melee.
   */
  private clashInputs(attackerId: number, defenderId: number): { atk: DamageInput; def: DamageInput } {
    const a = this.loadoutOf(attackerId);
    const d = this.loadoutOf(defenderId);
    const aStats = this.statsOf(attackerId);
    const dStats = this.statsOf(defenderId);

    // Slot 0 is a physical/special melee of the piece's declared type; use whichever offensive stat is
    // higher, matching the Assault spread's investment.
    const aPhysical = aStats.atk >= aStats.spa;
    const dPhysical = dStats.atk >= dStats.spa;

    const atk: DamageInput = {
      attackerType: a.type,
      moveType: a.type,
      defenderType: d.type,
      category: aPhysical ? 'Physical' : 'Special',
      basePower: MELEE_BASE_POWER,
      offensiveStat: aPhysical ? aStats.atk : aStats.spa,
      defensiveStat: aPhysical ? dStats.def : dStats.spd,
      stab: true,
    };
    const def: DamageInput = {
      attackerType: d.type,
      moveType: d.type,
      defenderType: a.type,
      category: dPhysical ? 'Physical' : 'Special',
      basePower: MELEE_BASE_POWER,
      offensiveStat: dPhysical ? dStats.atk : dStats.spa,
      defensiveStat: dPhysical ? aStats.def : aStats.spd,
      stab: true,
    };
    return { atk, def };
  }

  /**
   * The forecast verdict of a capture at the given luck (default representative).
   *
   * Runs the real Clash on scratch combatants, so the preview cannot disagree with the outcome under the
   * same luck — the promise the deterministic model makes to the player.
   */
  forecastVerdict(move: Move, roll: ClashRoll = { hits: true, crit: false, momentum: 100 }): Verdict {
    if (!move.captured) return 'quiet';
    const moverPiece = this.position.pieceAt(move.from)!;
    const attackerId = moverPiece.id;
    const defenderId = move.captured.id;

    const attacker = this.loadoutOf(attackerId);
    const mult = this.multiplierAgainst(attacker.type, defenderId);
    if (mult === 0) return 'blocked';

    const { atk, def } = this.clashInputs(attackerId, defenderId);
    const aLive = this.liveOf(attackerId);
    const dLive = this.liveOf(defenderId);
    const aC: Combatant = { hp: aLive.hp, maxHp: aLive.maxHp, speed: this.statsOf(attackerId).spe, pristine: aLive.pristine };
    const dC: Combatant = { hp: dLive.hp, maxHp: dLive.maxHp, speed: this.statsOf(defenderId).spe, pristine: dLive.pristine };
    const result = resolveClash(
      {
        attacker: aC,
        defender: dC,
        // A king defender reads 0× as 1×, so patch the counter's effectiveness by using the king's real
        // type but never letting the attacker be immune — handled by multiplierAgainst on offer, and the
        // damage floor of 1 here.
        attackerBlow: atk,
        defenderBlow: def,
        attackerSuperEffective: mult > 1,
      },
      roll,
    );
    return result.verdict;
  }

  // -------------------------------------------------------------------------
  // Playing a move
  // -------------------------------------------------------------------------

  /** Plays an action, drawing the Clash luck from the game's own RNG, and returns the resulting game. */
  play(move: Move): { game: PokemonChess; resolved: ResolvedMove } {
    const rng = new Rng(this.rngState);
    let roll: ClashRoll = { hits: true, crit: false, momentum: 100 };
    if (move.captured) {
      const momentum = 85 + rng.below(16); // uniform 85..100
      let crit = this.rules.critCoins > 0;
      for (let i = 0; i < this.rules.critCoins; i++) crit = crit && rng.chance(50);
      roll = { hits: true, crit, momentum };
    }
    const { game, resolved } = this.applyResolved(move, roll, rng.state);
    return { game, resolved };
  }

  /**
   * The pure core of {@link play}: applies a move with an already-drawn roll.
   *
   * Also used by the guarded-mode filter to look one move ahead, which is why the roll is a parameter and
   * the RNG state is optional — a forecast does not advance the real stream.
   */
  private applyResolved(
    move: Move,
    roll: ClashRoll,
    nextRngState: RngState = this.rngState,
  ): { game: PokemonChess; resolved: ResolvedMove } {
    const moverPiece = this.position.pieceAt(move.from)!;
    const side = moverPiece.side;
    const attackerId = moverPiece.id;
    const attacker = this.loadoutOf(attackerId);

    if (!move.captured) {
      const nextPos = this.position.withMove(move);
      const resolved: ResolvedMove = {
        move, side, attacker, defender: null, effectiveness: null,
        verdict: 'quiet',
        attackerHpAfter: this.liveOf(attackerId).hp,
        defenderHpAfter: 0,
        attackerMaxHp: this.liveOf(attackerId).maxHp,
        defenderMaxHp: null,
        crit: false, momentum: roll.momentum, blowCount: 0,
        grantsBonus: false, removed: [], kingCaptured: false,
      };
      return {
        game: this.next(nextPos, this.live, nextRngState, null, resolved),
        resolved,
      };
    }

    const defenderPiece = move.captured;
    const defenderId = defenderPiece.id;
    const defender = this.loadoutOf(defenderId);
    const mult = this.multiplierAgainst(attacker.type, defenderId);

    const aLive = this.liveOf(attackerId);
    const dLive = this.liveOf(defenderId);
    const aStats = this.statsOf(attackerId);
    const dStats = this.statsOf(defenderId);
    const aC: Combatant = { hp: aLive.hp, maxHp: aLive.maxHp, speed: aStats.spe, pristine: aLive.pristine };
    const dC: Combatant = { hp: dLive.hp, maxHp: dLive.maxHp, speed: dStats.spe, pristine: dLive.pristine };
    const { atk, def } = this.clashInputs(attackerId, defenderId);

    const result = resolveClash(
      { attacker: aC, defender: dC, attackerBlow: atk, defenderBlow: def, attackerSuperEffective: mult > 1 },
      roll,
    );

    // Apply the verdict to the board and to live HP.
    const nextLive = new Map(this.live);
    const removed: number[] = [];
    let nextPos = this.position;

    const setLive = (id: number, c: Combatant) =>
      nextLive.set(id, { hp: c.hp, maxHp: c.maxHp, pristine: c.pristine });

    switch (result.verdict) {
      case 'advantage':
      case 'capture':
        // Defender removed; attacker takes the square, carrying its (possibly reduced) HP.
        nextPos = this.position.withMove(move);
        nextLive.delete(defenderId);
        removed.push(defenderId);
        setLive(attackerId, aC);
        break;
      case 'mutual':
        // Defender removed then attacker removed; the square is left empty. Either may be a king — a
        // king capture is the win — so removal is king-permitting.
        nextPos = this.position.withMove(move).withPieceRemoved(move.to, true);
        nextLive.delete(defenderId);
        nextLive.delete(attackerId);
        removed.push(defenderId, attackerId);
        break;
      case 'rout':
        // Attacker removed; defender holds its square, wounded. A king that attacks and dies has lost.
        nextPos = this.position.withPieceRemoved(move.from, true);
        nextLive.delete(attackerId);
        removed.push(attackerId);
        setLive(defenderId, dC);
        break;
      case 'repel':
        // No one moves; both keep their damage.
        setLive(attackerId, aC);
        setLive(defenderId, dC);
        break;
    }

    const kingCaptured = removed.some((id) => this.pieceById(id)?.cls === 'king');

    // A bonus move is granted only by ADVANTAGE, only while the cap is unspent, and only if the piece can
    // actually continue — otherwise the turn passes.
    const used = this.pending?.used ?? 0;
    let pending: PendingExtraMove | null = null;
    let posForNext = nextPos;
    if (result.verdict === 'advantage' && used < this.rules.maxExtraMovesPerTurn && !kingCaptured) {
      const continued = nextPos.withTurnReturned();
      const canContinue = continued.generateMoves().some((m) => continued.pieceAt(m.from)?.id === attackerId);
      if (canContinue) {
        posForNext = continued;
        pending = { side, pieceId: attackerId, used: used + 1 };
      }
    }

    const resolved: ResolvedMove = {
      move, side, attacker, defender, effectiveness: mult,
      verdict: result.verdict,
      attackerHpAfter: result.attackerHpAfter,
      defenderHpAfter: result.defenderHpAfter,
      attackerMaxHp: aC.maxHp,
      defenderMaxHp: dC.maxHp,
      crit: roll.crit,
      momentum: roll.momentum,
      blowCount: result.blows.length,
      grantsBonus: pending !== null,
      removed,
      kingCaptured,
    };

    return {
      game: this.next(posForNext, nextLive, nextRngState, pending, resolved),
      resolved,
    };
  }

  private next(
    position: Position,
    live: ReadonlyMap<number, LiveState>,
    rngState: RngState,
    pending: PendingExtraMove | null,
    resolved: ResolvedMove,
  ): PokemonChess {
    return new PokemonChess(
      position, this.loadout, this.rules, this.stats, live, rngState, pending,
      [...this.history, resolved],
    );
  }

  // -------------------------------------------------------------------------
  // Result
  // -------------------------------------------------------------------------

  /**
   * The game's status, under the Regicide rule.
   *
   * A missing king ends the game: the side whose king remains wins. There is no checkmate — a mate-like
   * position where the king cannot escape is still `playing` and is only labelled by the UI. Draws are the
   * chess draws that survive: fifty-move, repetition, and a side with no legal action.
   */
  result(): GameResult {
    const whiteKing = !this.kingRemoved('white');
    const blackKing = !this.kingRemoved('black');
    if (whiteKing && !blackKing) return { kind: 'win', winner: 'white', by: 'king-capture' };
    if (blackKing && !whiteKing) return { kind: 'win', winner: 'black', by: 'king-capture' };

    if (this.rawMoves().length === 0) return { kind: 'draw', reason: 'no-legal-move' };
    if (this.position.isFiftyMoveDraw()) return { kind: 'draw', reason: 'fifty-move' };
    if (this.position.isThreefoldRepetition()) return { kind: 'draw', reason: 'repetition' };
    return { kind: 'playing' };
  }

  isOver(): boolean {
    return this.result().kind !== 'playing';
  }

  /**
   * Whether `side`'s king is capturable by the opponent's current actions at representative luck — R8's
   * advice, which the UI shows as the "your king can be taken" banner. Only meaningful when it is the
   * opponent's turn to move.
   */
  kingInDanger(side: Side): boolean {
    const enemy: Side = side === 'white' ? 'black' : 'white';
    if (this.turn !== enemy) return false;
    return this.rawMoves().some((m) => {
      const t = m.move.captured;
      if (!t || t.cls !== 'king' || t.side !== side) return false;
      return m.forecast === 'advantage' || m.forecast === 'capture' || m.forecast === 'mutual';
    });
  }

  /** Every piece with its Pokémon, stats and live HP, for rendering. */
  pieces(): {
    square: Square;
    piece: Piece;
    cls: PieceClass;
    pokemon: PokemonLoadout;
    live: LiveState;
  }[] {
    return this.position.allPieces().map(({ square, piece }) => ({
      square,
      piece,
      cls: piece.cls,
      pokemon: this.loadoutOf(piece.id),
      live: this.liveOf(piece.id),
    }));
  }
}

// Re-exported so the UI keeps importing species-typed helpers from one place.
export type { SpeciesEntry };
