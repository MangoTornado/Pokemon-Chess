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
import { KING_MOVES, fileOf, squareName } from './board.ts';
import type { PieceClass, Side, Square } from './board.ts';
import { Position } from './position.ts';
import { encodeArt, encodeTera, isArtMove, isTeraMove } from './position.ts';
import type { Move, Piece } from './position.ts';
import { Rng } from './rng.ts';
import type { RngState } from './rng.ts';
import { effectiveness } from './typechart.ts';
import { resolveClash } from '../rules/clash.ts';
import type { BlowRecord, ClashRoll, ClashVerdict, Combatant } from '../rules/clash.ts';
import type { DamageInput } from '../rules/damage.ts';
import { computeStats, stageMultiplier } from '../rules/stats.ts';
import type { PieceStats } from '../rules/stats.ts';
import { WONDER_GUARD, abilityGrantsImmunity, abilityLabel } from '../rules/abilities.ts';
import {
  attackCostFraction, checkupHealFraction, contactPunishFraction, defensiveItemMod, grantsSurviveOnce,
  offensiveItemMods,
} from '../rules/items.ts';
import { buildMoveset } from '../game/moveset.ts';
import type { Moveset } from '../game/moveset.ts';
import {
  applyBurn, applyPoison, applyRotation, cure, movementLock,
  POISON_LETHAL_COUNT, POISON_RATE, SLEEP_TURN_CAP,
} from './status.ts';
import type { PieceStatus } from './status.ts';
import { applyBoosts, hasAnyStage, stageOf } from './stages.ts';
import {
  EMPTY_FIELD, SCREEN_TURNS, WEATHER_TURNS, addHazardLayer, hazardToll, hazardZone, screenMod, tickScreens,
  tickWeather, weatherChipFraction, weatherDamageMod,
} from './field.ts';
import type { Field } from './field.ts';
import { pickArt } from '../game/arts.ts';
import { DRAW_BOOST, GUARD_TURNS, abilityDraws } from '../rules/redirect.ts';
import type { Interception } from '../rules/redirect.ts';
import type { Art } from '../game/arts.ts';
import type { StatStages } from './stages.ts';

// ---------------------------------------------------------------------------
// Loadouts and live state
// ---------------------------------------------------------------------------

/** The Pokémon in a chess piece's shoes, and the single type it fights and defends as. */
export interface PokemonLoadout {
  readonly species: string;
  readonly type: BattleType;
  /** The four-slot moveset. Optional in a loadout — auto-picked from the learnset when absent. */
  readonly moves?: Moveset;
  /** The ability the piece fights with (an id from the species' real abilities). Grants type immunities. */
  readonly ability?: string;
  /** The held item (a real dex item id). Scales blows, reduces damage taken, or heals at Checkup. */
  readonly item?: string;
  /**
   * The type this piece becomes if it Terastallises.
   *
   * Type is this game's core mechanic, so changing it is the most consequential transformation available:
   * a Tera'd piece resists different things and gains STAB on a different move. Auto-picked at draft time.
   */
  readonly teraType?: BattleType;
  /**
   * The field move this piece can cast instead of moving (weather, or a band of hazards).
   *
   * Absent for most pieces, which is the point: a team that can shape the field is built deliberately.
   * Auto-picked from the species' learnset when the loadout does not name one.
   */
  readonly art?: Art;
  /** Set when this action Terastallises the piece — changing the type it fights and defends as. */
  readonly tera?: BattleType;
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
  /** The moveset slot this capture would use (the best legal one); 0 for a quiet move. */
  readonly slot: number;
  /** The name of the move used, for the UI; null for a quiet move. */
  readonly moveName: string | null;
  /** True when this action must be played by the piece that just earned a bonus move. */
  readonly isExtraMove: boolean;
  /**
   * Set when this action is an art cast (a field effect) rather than a board move.
   *
   * The UI offers it separately, the AI treats it as any other action, and the encoded form carries the
   * `MOVE_ART` flag so a replay reproduces it.
   */
  readonly art?: Art;
  /** Set when this action Terastallises the piece — changing the type it fights and defends as. */
  readonly tera?: BattleType;
}

/**
 * Set when a third piece answered an attack in the target's place.
 *
 * Note which way round this reads: every `defender*` field on the resolution describes the piece that
 * *actually fought*, because those are the numbers the exchange produced. This report carries the piece that
 * was originally aimed at, which is the part that would otherwise be lost — "Groudon took the hit meant for
 * Gyarados" needs both halves, and naming the wrong one as the defender would contradict the HP beside it.
 */
export interface InterceptReport {
  readonly pieceId: number;
  readonly square: Square;
  readonly kind: 'draw' | 'guard';
  /** The piece the attack was aimed at, which never entered the exchange. */
  readonly insteadOf: PokemonLoadout;
  /** The ability that drew the attack, for a `draw`. */
  readonly ability?: string;
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
  /**
   * Every blow of the exchange, in order — who threw it, for how much, and the target's HP after.
   *
   * This is what lets the board *show* the Clash rather than only its verdict: a damage number per blow,
   * a hit reaction per blow, and the attacker's and defender's swings distinguishable.
   */
  readonly blows: readonly BlowRecord[];
  /** The move the attacker used, and its type, so an impact can be announced and coloured. */
  readonly moveName: string | null;
  readonly moveType: BattleType | null;
  /** A status mark this action inflicted on the surviving defender, if any (`burned`, `poisoned`, …). */
  readonly statusInflicted: string | null;
  /** Stage changes this action landed on the surviving defender, e.g. `{ spe: -1 }` — null if none. */
  readonly boostsInflicted: Readonly<Record<string, number>> | null;
  /** Damage the attacker did to itself (recoil, Life Orb) or took from a contact item. 0 for none. */
  /** Set when a third piece answered this attack in the target's place. */
  readonly intercepted?: InterceptReport;
  readonly recoilTaken: number;
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

/** Applies a rider status mark to a piece's status, routing each mark to the right applier. */
function applyRider(status: PieceStatus, mark: string): PieceStatus {
  switch (mark) {
    case 'burned':
      return applyBurn(status);
    case 'poisoned':
      return applyPoison(status, 'poisoned');
    case 'badly-poisoned':
      return applyPoison(status, 'badlyPoisoned');
    case 'paralyzed':
    case 'asleep':
    case 'confused':
      return applyRotation(status, mark);
    default:
      return status;
  }
}

export class PokemonChess {
  readonly position: Position;
  readonly loadout: Loadout;
  readonly rules: VariantRules;
  /**
   * The dex, for the static facts an effect needs about a species (whether it is not-fully-evolved, which
   * gates Eviolite; later, ability and item descriptors). Read-only and shared, so carrying it costs
   * nothing and every derived game keeps it.
   */
  private readonly dex: Dex;
  /** Battle stats per piece id, computed once — pieces do not change species mid-game (yet). */
  private readonly stats: ReadonlyMap<number, PieceStats>;
  /** The four-slot moveset per piece id, so a capture can use coverage, not only the declared type. */
  private readonly movesets: ReadonlyMap<number, Moveset>;
  /** Live HP per piece id. Absent means full HP (never damaged), so a fresh game stores nothing. */
  private readonly live: ReadonlyMap<number, LiveState>;
  /** Status conditions per piece id. Absent means healthy, so a fresh game stores nothing. */
  private readonly statuses: ReadonlyMap<number, PieceStatus>;
  /** Stat stages per piece id. Absent means all stage 0, so a fresh game stores nothing. */
  private readonly stages: ReadonlyMap<number, StatStages>;
  /** Weather over the board and hazards laid on it — the battlefield's own state. */
  readonly field: Field;
  /**
   * Pieces that have Terastallised, and so fight as their Tera type.
   *
   * One per side per game, as in the games — which makes it a decision about *when*, not just whether. The
   * set is small and immutable, so it threads through game state like the rest.
   */
  private readonly tera: ReadonlySet<number>;

  /**
   * Pieces currently volunteering to answer for their neighbours, and for how many more of their side's turns.
   *
   * Keyed by piece rather than square because a guard that moves keeps its watch, which is what makes casting
   * one a real commitment rather than a square-bound trap.
   */
  private readonly guards: ReadonlyMap<number, number>;
  /**
   * The field move each piece can cast, or null — computed once at creation.
   *
   * Static per piece, exactly like its stats and its moveset, so it is built in `create` and carried
   * forward. Deriving it lazily instead was a real performance bug: `rawMoves` asks for every piece's art on
   * every call, and every `play` makes a new game, so a lazy cache re-scanned 32 learnsets per node of AI
   * search.
   */
  private readonly arts: ReadonlyMap<number, Art | null>;
  private readonly rngState: RngState;
  private readonly pending: PendingExtraMove | null;
  readonly history: readonly ResolvedMove[];

  // Explicit field assignment (not TypeScript parameter properties) so the engine runs unchanged under
  // Node's strip-only TypeScript — which is what lets the server import it and validate moves server-side.
  private constructor(
    position: Position,
    loadout: Loadout,
    rules: VariantRules,
    dex: Dex,
    stats: ReadonlyMap<number, PieceStats>,
    movesets: ReadonlyMap<number, Moveset>,
    arts: ReadonlyMap<number, Art | null>,
    live: ReadonlyMap<number, LiveState>,
    statuses: ReadonlyMap<number, PieceStatus>,
    stages: ReadonlyMap<number, StatStages>,
    field: Field,
    tera: ReadonlySet<number>,
    guards: ReadonlyMap<number, number>,
    rngState: RngState,
    pending: PendingExtraMove | null,
    history: readonly ResolvedMove[],
  ) {
    this.position = position;
    this.loadout = loadout;
    this.rules = rules;
    this.dex = dex;
    this.stats = stats;
    this.movesets = movesets;
    this.arts = arts;
    this.live = live;
    this.statuses = statuses;
    this.stages = stages;
    this.field = field;
    this.tera = tera;
    this.guards = guards;
    this.rngState = rngState;
    this.pending = pending;
    this.history = history;
  }

  static create(options: {
    dex: Dex;
    position?: Position;
    loadout: Loadout;
    seed: string | number;
    /** Any subset of the rules; unspecified fields take their `DEFAULT_RULES` value. */
    rules?: Partial<VariantRules>;
    /**
     * Weather the match starts in and never loses — a battlefield condition rather than a cast effect.
     *
     * A Rain match rewards a Water army and punishes a Fire one, so this is a real drafting decision, and
     * it is how a themed arena (or a Gym Leader's home turf) is expressed.
     */
    weather?: import('./field.ts').WeatherKind;
  }): PokemonChess {
    const position = options.position ?? Position.fromStartingPosition();
    const stats = new Map<number, PieceStats>();
    const movesets = new Map<number, Moveset>();
    const arts = new Map<number, Art | null>();
    for (const { piece } of position.allPieces()) {
      const entry = options.loadout.get(piece.id);
      if (!entry) throw new Error(`no Pokémon assigned to piece ${piece.id}`);
      const species = options.dex.getSpecies(entry.species);
      if (!species) throw new Error(`unknown species ${entry.species}`);
      stats.set(piece.id, computeStats(species));
      // A loadout may carry a hand-picked moveset (from the draft); otherwise auto-pick one from the
      // species' learnset, keyed on the piece id so the kit is stable for the game.
      movesets.set(piece.id, entry.moves ?? buildMoveset(options.dex, species, entry.type, `${options.seed}:${piece.id}`));
      arts.set(piece.id, entry.art ?? pickArt(options.dex, species.id, `${options.seed}:${piece.id}`));
    }
    return new PokemonChess(
      position,
      options.loadout,
      options.rules ? { ...DEFAULT_RULES, ...options.rules } : DEFAULT_RULES,
      options.dex,
      stats,
      movesets,
      arts,
      new Map(), // live HP
      new Map(), // statuses
      new Map(), // stat stages
      options.weather
        ? { ...EMPTY_FIELD, weather: { kind: options.weather, turns: Infinity } }
        : EMPTY_FIELD,
      new Set(), // nobody has Terastallised yet
      new Map(), // nobody is guarding yet
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
  multiplierAgainst(attackerType: BattleType, defenderId: number): number {
    const raw = effectiveness(attackerType, this.battleTypeOf(defenderId));
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
      // A sleeping or paralyzed piece cannot act this turn; it offers no moves at all.
      if (movementLock(this.statusOf(moverPiece.id)) !== null) continue;
      const attacker = this.loadoutOf(moverPiece.id);

      if (!move.captured) {
        out.push({
          move,
          attacker,
          defender: null,
          effectiveness: null,
          forecast: 'quiet',
          slot: 0,
          moveName: null,
          isExtraMove: pending !== null,
        });
        continue;
      }

      const defenderId = move.captured.id;
      // A capture is offered if ANY slot can hurt the defender; the best slot's effectiveness is shown.
      const best = this.bestSlotAgainst(moverPiece.id, defenderId);
      if (!best) continue; // BLOCKED — no slot can touch it (never reached for a king, per R6).

      out.push({
        move,
        attacker,
        defender: this.loadoutOf(defenderId),
        effectiveness: best.multiplier,
        forecast: this.forecastVerdict(move),
        slot: best.slot,
        moveName: this.movesetOf(moverPiece.id)[best.slot]!.name,
        isExtraMove: pending !== null,
      });
    }

    // Terastallisation: one per side per game, so it is a decision about *when*. Offered only to a piece
    // whose Tera type would actually differ from the type it is already fighting as.
    if (pending === null && this.teraAvailable(this.position.turn)) {
      for (const { square, piece } of this.position.allPieces()) {
        if (piece.side !== this.position.turn) continue;
        if (movementLock(this.statusOf(piece.id)) !== null) continue;
        const teraType = this.loadoutOf(piece.id).teraType;
        if (!teraType || teraType === this.battleTypeOf(piece.id)) continue;
        out.push({
          move: this.pseudoMoveFor(square, piece.cls, encodeTera(square, piece.cls)),
          attacker: this.loadoutOf(piece.id),
          defender: null,
          effectiveness: null,
          forecast: 'quiet',
          slot: 0,
          moveName: `Terastallise → ${teraType}`,
          isExtraMove: false,
          tera: teraType,
        });
      }
    }

    // Art casts: a piece may spend its turn shaping the field instead of moving. Never offered as a bonus
    // move, because the bonus exists to continue an assault, and never while the caster is incapacitated.
    if (pending === null) {
      for (const { square, piece } of this.position.allPieces()) {
        if (piece.side !== this.position.turn) continue;
        if (movementLock(this.statusOf(piece.id)) !== null) continue;
        const art = this.artOf(piece.id);
        if (!art) continue;
        if (!this.artWouldChangeAnything(art, piece.side, square)) continue;
        out.push({
          move: this.pseudoMoveFor(square, piece.cls, encodeArt(square, piece.cls)),
          attacker: this.loadoutOf(piece.id),
          defender: null,
          effectiveness: null,
          forecast: 'quiet',
          slot: 0,
          moveName: art.name,
          isExtraMove: false,
          art,
        });
      }
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

  /**
   * Applies a move at a fixed roll without advancing the game's RNG — for AI search.
   *
   * `play` draws the Clash luck from the shared RNG stream and consumes it, which is correct for an
   * actual move but wrong for a search node, where each branch must be evaluated independently and the
   * stream must not move. This resolves the move at a caller-supplied roll (default representative:
   * hits, no crit, momentum 92, the band's midpoint), so the search sees a stable expected line. The
   * resulting game carries the same RNG state it started with.
   */
  simulate(move: Move, roll: ClashRoll = { hits: true, crit: false, momentum: 92 }): PokemonChess {
    return this.applyResolved(move, roll, this.rngState).game;
  }

  // -------------------------------------------------------------------------
  // Clash setup and resolution
  // -------------------------------------------------------------------------

  /**
   * Builds the two damage inputs for a Clash, given the attacker's chosen slot.
   *
   * The attacker strikes with its chosen move's type, power and category (STAB when that type equals its
   * declared type — an ordinary same-type melee). The defender always counters with its own declared-type
   * melee, because in a Clash it hits back with what it is, not with a chosen coverage move.
   */
  private clashInputs(attackerId: number, defenderId: number, slot: number): { atk: DamageInput; def: DamageInput } {
    const a = this.loadoutOf(attackerId);
    const d = this.loadoutOf(defenderId);
    const aStats = this.statsOf(attackerId);
    const dStats = this.statsOf(defenderId);
    const move = this.movesetOf(attackerId)[slot] ?? this.movesetOf(attackerId)[0]!;

    // Read the *fighting* types, which differ from the declared ones for a Terastallised piece.
    const aType = this.battleTypeOf(attackerId);
    const dType = this.battleTypeOf(defenderId);
    const aPhysical = move.category === 'Physical';
    const dPhysical = dStats.atk >= dStats.spa;
    const aCategory = aPhysical ? 'Physical' : 'Special';
    const dCategory = dPhysical ? 'Physical' : 'Special';

    // Held items scale the blow being thrown and reduce the blow being taken (SPEC §5 steps 2/13/14).
    const aItem = offensiveItemMods(a.item, move.type, aCategory, effectiveness(move.type, d.type) > 1);
    const dItem = offensiveItemMods(d.item, dType, dCategory, effectiveness(dType, aType) > 1);
    // A side's screen halves the damage its own pieces take of that category, folded into the same
    // defender hook as a defensive item — the pipeline requires such a hook to be <= 1, and both are.
    const aSide = this.pieceById(attackerId)?.side ?? 'white';
    const dSide = this.pieceById(defenderId)?.side ?? 'black';
    const aDefend = defensiveItemMod(a.item, dCategory, this.isNfe(a.species))
      * screenMod(this.field.screens[aSide], dCategory);
    const dDefend = defensiveItemMod(d.item, aCategory, this.isNfe(d.species))
      * screenMod(this.field.screens[dSide], aCategory);

    // Stat stages feed the pipeline's existing stage inputs, so a −1 Defence drop shows up as more damage
    // taken on every later exchange — a lasting wound, since nothing resets here.
    const aStages = this.stagesOf(attackerId);
    const dStages = this.stagesOf(defenderId);

    const atk: DamageInput = {
      attackerType: aType,
      moveType: move.type,
      defenderType: dType,
      category: aCategory,
      basePower: move.basePower,
      offensiveStat: aPhysical ? aStats.atk : aStats.spa,
      defensiveStat: aPhysical ? dStats.def : dStats.spd,
      offensiveStage: stageOf(aStages, aPhysical ? 'atk' : 'spa'),
      defensiveStage: stageOf(dStages, aPhysical ? 'def' : 'spd'),
      stab: move.type === aType,
      // A burned piece hits weaker with physical moves — the games' Attack halving, as a Clash penalty.
      burned: this.statusOf(attackerId).burned !== undefined,
      basePowerMod: aItem.basePowerMod,
      attackerFinalMod: aItem.attackerFinalMod,
      defenderFinalMod: dDefend,
      weatherMod: weatherDamageMod(this.field.weather, move.type),
    };
    const def: DamageInput = {
      attackerType: dType,
      moveType: dType,
      defenderType: aType,
      category: dCategory,
      basePower: MELEE_BASE_POWER,
      offensiveStat: dPhysical ? dStats.atk : dStats.spa,
      defensiveStat: dPhysical ? aStats.def : aStats.spd,
      offensiveStage: stageOf(dStages, dPhysical ? 'atk' : 'spa'),
      defensiveStage: stageOf(aStages, dPhysical ? 'def' : 'spd'),
      stab: true,
      basePowerMod: dItem.basePowerMod,
      attackerFinalMod: dItem.attackerFinalMod,
      defenderFinalMod: aDefend,
      weatherMod: weatherDamageMod(this.field.weather, dType),
    };
    return { atk, def };
  }

  /** Whether a species is not-fully-evolved, which is what gates Eviolite. */
  private isNfe(species: string): boolean {
    return this.dex.getSpecies(species)?.nfe ?? false;
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

    // Forecast the exchange that will actually be fought, not the one that was aimed at. A redirected attack
    // resolves against the interceptor, so previewing the target would promise the player an outcome the
    // engine will not deliver — and the board's whole contract is that a square says beforehand what it does.
    const intercept = this.interceptorFor(attackerId, move.captured.id);
    if (intercept?.kind === 'draw') return 'blocked';
    const defenderId = intercept ? intercept.pieceId : move.captured.id;

    // Use the best legal slot — coverage may make a capture the declared type could not.
    const best = this.bestSlotAgainst(attackerId, defenderId);
    if (!best) return 'blocked';
    const mult = best.multiplier;

    const { atk, def } = this.clashInputs(attackerId, defenderId, best.slot);
    const aLive = this.liveOf(attackerId);
    const dLive = this.liveOf(defenderId);
    const aC: Combatant = { hp: aLive.hp, maxHp: aLive.maxHp, speed: this.effectiveSpeed(attackerId), pristine: aLive.pristine, surviveOnce: grantsSurviveOnce(this.loadoutOf(attackerId).item) };
    const dC: Combatant = { hp: dLive.hp, maxHp: dLive.maxHp, speed: this.effectiveSpeed(defenderId), pristine: dLive.pristine, surviveOnce: grantsSurviveOnce(this.loadoutOf(defenderId).item) };
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
        ...this.recoilInputs(attackerId, defenderId, best.slot),
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
    let riderHits = false;
    let boostHits = false;
    let hitRoll = 0;
    if (move.captured) {
      const momentum = 85 + rng.below(16); // uniform 85..100
      let crit = this.rules.critCoins > 0;
      for (let i = 0; i < this.rules.critCoins; i++) crit = crit && rng.chance(50);
      roll = { hits: true, crit, momentum };
      // Whether the chosen move's status rider lands, drawn from the same stream so it is replayable.
      const mover = this.position.pieceAt(move.from);
      const best = mover ? this.bestSlotAgainst(mover.id, move.captured.id) : null;
      const slot = best ? this.movesetOf(mover!.id)[best.slot] : undefined;
      if (slot?.rider) riderHits = rng.chance(slot.rider.chance);
      // The target's stage change is its own draw, taken in a fixed order so a replay reproduces it.
      if (slot?.targetBoosts) boostHits = rng.chance(slot.targetBoosts.chance);
      // A ranged multi-hit move's strike count, drawn from the same stream.
      if (slot?.hits !== undefined && typeof slot.hits !== 'number') hitRoll = rng.below(64);
    }
    const { game, resolved } = this.applyResolved(move, roll, rng.state, riderHits, boostHits, hitRoll);
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
    riderHits = false,
    boostHits = false,
    hitRoll = 0,
  ): { game: PokemonChess; resolved: ResolvedMove } {
    const moverPiece = this.position.pieceAt(move.from)!;
    const side = moverPiece.side;
    const attackerId = moverPiece.id;
    const attacker = this.loadoutOf(attackerId);

    // Terastallisation: the piece changes the type it fights as and the turn passes. No board change, and no
    // Clash, so it cannot hurt anyone by itself — its whole effect is on every exchange afterwards.
    if (isTeraMove(move.encoded)) {
      const nextTera = new Set(this.tera);
      nextTera.add(attackerId);
      const resolved: ResolvedMove = {
        move, side, attacker, defender: null, effectiveness: null,
        verdict: 'quiet',
        attackerHpAfter: this.liveOf(attackerId).hp,
        defenderHpAfter: 0,
        attackerMaxHp: this.liveOf(attackerId).maxHp,
        defenderMaxHp: null,
        crit: false, momentum: roll.momentum, blowCount: 0, blows: [],
        moveName: attacker.teraType ? `Terastallise → ${attacker.teraType}` : 'Terastallise',
        moveType: attacker.teraType ?? null,
        statusInflicted: null, boostsInflicted: null, recoilTaken: 0,
        grantsBonus: false, removed: [], kingCaptured: false,
      };
      const nextPos = this.position.withTurnReturned();
      const up = this.checkup(side, nextPos, this.live, this.statuses, this.field);
      return {
        game: this.next({
          position: up.position, live: up.live, statuses: up.statuses, field: up.field, tera: nextTera,
          guards: up.guards, rngState: nextRngState, pending: null,
        }, resolved),
        resolved,
      };
    }

    // An art cast: the piece stays put and shapes the field instead. No board change, so the turn is passed
    // explicitly, exactly as the REPEL verdict does.
    if (isArtMove(move.encoded)) {
      const art = this.artOf(attackerId);
      const nextField = art ? this.fieldAfterArt(art, side, move.from) : this.field;

      const resolved: ResolvedMove = {
        move, side, attacker, defender: null, effectiveness: null,
        verdict: 'quiet',
        attackerHpAfter: this.liveOf(attackerId).hp,
        defenderHpAfter: 0,
        attackerMaxHp: this.liveOf(attackerId).maxHp,
        defenderMaxHp: null,
        crit: false, momentum: roll.momentum, blowCount: 0, blows: [],
        moveName: art?.name ?? null, moveType: null, statusInflicted: null, boostsInflicted: null, recoilTaken: 0,
        grantsBonus: false, removed: [], kingCaptured: false,
      };
      const nextPos = this.position.withTurnReturned();
      const up = this.checkup(side, nextPos, this.live, this.statuses, nextField);
      // Set the guard on top of the aged map, not before it: the caster's own Checkup must not age the
      // guard it just cast, or it would lapse before the enemy turn it exists to cover.
      const nextGuards = art ? this.guardsAfterArt(art, attackerId, up.guards) : up.guards;
      return {
        game: this.next({
          position: up.position, live: up.live, statuses: up.statuses, field: up.field,
          guards: nextGuards, rngState: nextRngState, pending: null,
        }, resolved),
        resolved,
      };
    }

    if (!move.captured) {
      const nextPos = this.position.withMove(move);
      // Arriving on a hazardous square exacts its toll before anything else — that is what hazards are for.
      const arrival = this.applyHazards(attackerId, move.to, this.live, this.statuses, this.stages, nextPos);
      const resolved: ResolvedMove = {
        move, side, attacker, defender: null, effectiveness: null,
        verdict: 'quiet',
        attackerHpAfter: arrival.live.get(attackerId)?.hp ?? this.liveOf(attackerId).hp,
        defenderHpAfter: 0,
        attackerMaxHp: this.liveOf(attackerId).maxHp,
        defenderMaxHp: null,
        crit: false, momentum: roll.momentum, blowCount: 0, blows: [],
        moveName: null, moveType: null,
        statusInflicted: arrival.status, boostsInflicted: arrival.boosts, recoilTaken: 0,
        grantsBonus: false, removed: arrival.removed, kingCaptured: false,
      };
      // A quiet move always passes the turn, so the mover's side takes its end-of-turn Checkup.
      const up = this.checkup(side, arrival.position, arrival.live, arrival.statuses, this.field);
      return {
        game: this.next({
          position: up.position, live: up.live, statuses: up.statuses, stages: arrival.stages,
          field: up.field, guards: up.guards, rngState: nextRngState, pending: null,
        }, resolved),
        resolved,
      };
    }

    const defenderPiece = move.captured;
    const targetId = defenderPiece.id;

    // Redirection, resolved before the Clash because a Clash is between exactly two pieces and this decides
    // which two. A drawing ability absorbs the attack outright; a cast guard fights it in the target's place.
    const intercept = this.interceptorFor(attackerId, targetId);
    if (intercept?.kind === 'draw') {
      return this.absorbedAttack(move, side, attackerId, attacker, intercept, targetId, roll, nextRngState);
    }
    const defenderId = intercept ? intercept.pieceId : targetId;
    const redirected = intercept !== null;
    // The piece that actually fights, so every `defender*` number below describes one and the same piece.
    const defender = this.loadoutOf(defenderId);

    // Resolve with the best legal slot — the same one the forecast and the offer used.
    const best = this.bestSlotAgainst(attackerId, defenderId);
    const slot = best?.slot ?? 0;
    const mult = best?.multiplier ?? this.multiplierAgainst(this.battleTypeOf(attackerId), defenderId);

    const aLive = this.liveOf(attackerId);
    const dLive = this.liveOf(defenderId);
    const aC: Combatant = { hp: aLive.hp, maxHp: aLive.maxHp, speed: this.effectiveSpeed(attackerId), pristine: aLive.pristine, surviveOnce: grantsSurviveOnce(attacker.item) };
    const dC: Combatant = { hp: dLive.hp, maxHp: dLive.maxHp, speed: this.effectiveSpeed(defenderId), pristine: dLive.pristine, surviveOnce: grantsSurviveOnce(this.loadoutOf(defenderId).item) };
    const { atk, def } = this.clashInputs(attackerId, defenderId, slot);

    const result = resolveClash(
      {
        attacker: aC, defender: dC, attackerBlow: atk, defenderBlow: def,
        attackerSuperEffective: mult > 1,
        ...this.recoilInputs(attackerId, defenderId, slot, hitRoll),
      },
      roll,
    );

    // Apply the verdict to the board and to live HP.
    const nextLive = new Map(this.live);
    const removed: number[] = [];
    let nextPos = this.position;

    const setLive = (id: number, c: Combatant) =>
      nextLive.set(id, { hp: c.hp, maxHp: c.maxHp, pristine: c.pristine });

    if (redirected) {
      // Nobody relocates. The square the attacker went for was never actually contested, so winning the
      // exchange takes material but no ground — that trade is what makes redirection worth a tempo, and it is
      // also why a guard can rout an attacker that never attacked it. Whoever fell is removed from its own
      // square; the piece that was originally attacked is untouched.
      const guardSquare = intercept!.square;
      nextPos = this.position;
      if (dC.hp <= 0) {
        nextPos = nextPos.withPieceRemoved(guardSquare, true);
        nextLive.delete(defenderId);
        removed.push(defenderId);
      } else {
        setLive(defenderId, dC);
      }
      if (aC.hp <= 0) {
        nextPos = nextPos.withPieceRemoved(move.from, true);
        nextLive.delete(attackerId);
        removed.push(attackerId);
      } else {
        setLive(attackerId, aC);
      }
      nextPos = nextPos.withTurnReturned();
    } else {
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
        // No piece relocates, so the turn must be passed explicitly (withPieceRemoved does not flip it).
        nextPos = this.position.withPieceRemoved(move.from, true).withTurnReturned();
        nextLive.delete(attackerId);
        removed.push(attackerId);
        setLive(defenderId, dC);
        break;
      case 'repel':
        // No one moves and no one falls, but the attack was still the mover's action, so the turn passes.
        nextPos = this.position.withTurnReturned();
        setLive(attackerId, aC);
        setLive(defenderId, dC);
        break;
    }
    }

    const kingCaptured = removed.some((id) => this.pieceById(id)?.cls === 'king');

    // Status: the attacker's move rider lands on a defender that SURVIVED the exchange (a repel, or a
    // rout where the defender lives). A removed defender takes no status — it is already gone.
    const nextStatus = new Map(this.statuses);
    for (const id of removed) nextStatus.delete(id);
    const defenderSurvives = dC.hp > 0 && !removed.includes(defenderId);
    // The move actually thrown, and the mark it landed (if any) — both surfaced on the result so the board
    // can announce them.
    const usedMove = this.movesetOf(attackerId)[slot];
    let inflicted: string | null = null;
    if (defenderSurvives && riderHits) {
      const rider = usedMove?.rider;
      if (rider) {
        nextStatus.set(defenderId, applyRider(this.statusOf(defenderId), rider.mark));
        inflicted = rider.mark;
      }
    }

    // Stat stages. A target's drop needs the target alive to matter; the move's cost to its own user
    // (Close Combat's −1 Def/SpD) applies whenever the attacker survives to carry it.
    const nextStages = new Map(this.stages);
    for (const id of removed) nextStages.delete(id);
    let boostsApplied: Readonly<Record<string, number>> | null = null;
    if (defenderSurvives && boostHits && usedMove?.targetBoosts) {
      const next = applyBoosts(this.stagesOf(defenderId), usedMove.targetBoosts.boosts);
      if (hasAnyStage(next)) nextStages.set(defenderId, next);
      else nextStages.delete(defenderId);
      boostsApplied = usedMove.targetBoosts.boosts;
    }
    const attackerSurvives = aC.hp > 0 && !removed.includes(attackerId);
    if (attackerSurvives && usedMove?.selfBoosts) {
      const next = applyBoosts(this.stagesOf(attackerId), usedMove.selfBoosts);
      if (hasAnyStage(next)) nextStages.set(attackerId, next);
      else nextStages.delete(attackerId);
    }

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
      blows: result.blows,
      moveName: usedMove?.name ?? null,
      moveType: usedMove?.type ?? null,
      statusInflicted: inflicted,
      boostsInflicted: boostsApplied,
      recoilTaken: result.recoilTaken,
      ...(intercept
        ? {
            intercepted: {
              pieceId: intercept.pieceId, square: intercept.square, kind: intercept.kind,
              insteadOf: this.loadoutOf(targetId),
            },
          }
        : {}),
      grantsBonus: pending !== null,
      removed,
      kingCaptured,
    };

    // When the turn passes (no bonus, game not decided), the mover's side takes its end-of-turn Checkup.
    if (pending === null && !kingCaptured) {
      const up = this.checkup(side, posForNext, nextLive, nextStatus, this.field);
      return {
        game: this.next({
          position: up.position, live: up.live, statuses: up.statuses, stages: nextStages, field: up.field,
          guards: up.guards, rngState: nextRngState, pending: null,
        }, resolved),
        resolved,
      };
    }
    return {
      game: this.next({ position: posForNext, live: nextLive, statuses: nextStatus, stages: nextStages, rngState: nextRngState, pending }, resolved),
      resolved,
    };
  }

  /**
   * The successor state, named rather than positional.
   *
   * Every field defaults to this game's current value, so a call site spells out only what its action actually
   * changed — which is both the honest reading of the code and the reason it is a patch: a long positional
   * argument list grows a new parameter in the middle every time the game gains a layer, and inserting one in
   * the wrong place silently shifts every argument after it. `rngState` and `pending` are required because
   * every action has to decide both: inheriting a stale `pending` would hand a side a move it did not earn.
   */
  private next(
    patch: {
      readonly position?: Position;
      readonly live?: ReadonlyMap<number, LiveState>;
      readonly statuses?: ReadonlyMap<number, PieceStatus>;
      readonly stages?: ReadonlyMap<number, StatStages>;
      readonly field?: Field;
      readonly tera?: ReadonlySet<number>;
      readonly guards?: ReadonlyMap<number, number>;
      readonly rngState: RngState;
      readonly pending: PendingExtraMove | null;
    },
    resolved: ResolvedMove,
  ): PokemonChess {
    return new PokemonChess(
      patch.position ?? this.position, this.loadout, this.rules, this.dex, this.stats, this.movesets,
      this.arts,
      patch.live ?? this.live,
      patch.statuses ?? this.statuses,
      patch.stages ?? this.stages,
      patch.field ?? this.field,
      patch.tera ?? this.tera,
      patch.guards ?? this.guards,
      patch.rngState,
      patch.pending,
      [...this.history, resolved],
    );
  }

  /** The status a piece is carrying, defaulting to healthy. */
  statusOf(pieceId: number): PieceStatus {
    return this.statuses.get(pieceId) ?? {};
  }

  /**
   * The field after an art is cast: fresh weather, a screen, or another layer across the enemy hazard band.
   *
   * A guard cast (Follow Me) changes no field state — it marks the caster instead — so it leaves the field
   * exactly as it found it and {@link guardsAfterArt} does that work.
   */
  private fieldAfterArt(art: Art, side: Side, square: Square): Field {
    if (art.effect.kind === 'guard') return this.field;
    if (art.effect.kind === 'weather') {
      return { ...this.field, weather: { kind: art.effect.weather, turns: WEATHER_TURNS } };
    }
    if (art.effect.kind === 'screen') {
      return {
        ...this.field,
        screens: {
          ...this.field.screens,
          [side]: { ...this.field.screens[side], [art.effect.screen]: SCREEN_TURNS },
        },
      };
    }
    const hazards = new Map(this.field.hazards);
    for (const sq of hazardZone(side, fileOf(square))) {
      const next = addHazardLayer(hazards.get(sq) ?? {}, art.effect.hazard);
      hazards.set(sq, next);
    }
    return { ...this.field, hazards };
  }

  /**
   * The toll a piece pays for arriving on a hazardous square.
   *
   * Damage first (and a non-king may fall to it, exactly as poison can), then Toxic Spikes' poison and Sticky
   * Web's Speed drop. A king clamps to 1 HP rather than dying, the same mercy the Regicide rule R7 gives it
   * against residual damage — a game should not end because a king stepped on a spike.
   */
  private applyHazards(
    pieceId: number,
    square: Square,
    live: ReadonlyMap<number, LiveState>,
    statuses: ReadonlyMap<number, PieceStatus>,
    stages: ReadonlyMap<number, StatStages>,
    position: Position,
  ): {
    position: Position;
    live: ReadonlyMap<number, LiveState>;
    statuses: ReadonlyMap<number, PieceStatus>;
    stages: ReadonlyMap<number, StatStages>;
    removed: number[];
    status: string | null;
    boosts: Readonly<Record<string, number>> | null;
  } {
    const at = this.field.hazards.get(square);
    const none = { position, live, statuses, stages, removed: [] as number[], status: null, boosts: null };
    if (!at) return none;

    const toll = hazardToll(at, this.battleTypeOf(pieceId));
    if (toll.damageFraction === 0 && !toll.status && !toll.boosts) return none;

    const nlive = new Map(live);
    const nstat = new Map(statuses);
    const nstages = new Map(stages);
    const removed: number[] = [];
    let pos = position;

    const current = nlive.get(pieceId) ?? this.liveOf(pieceId);
    if (toll.damageFraction > 0) {
      const damage = Math.max(1, Math.floor(current.maxHp * toll.damageFraction));
      const isKing = this.pieceById(pieceId)?.cls === 'king';
      const hp = current.hp - damage;
      if (hp <= 0 && isKing) {
        nlive.set(pieceId, { ...current, hp: 1, pristine: false });
      } else if (hp <= 0) {
        pos = pos.withPieceRemoved(square, false);
        nlive.delete(pieceId);
        nstat.delete(pieceId);
        nstages.delete(pieceId);
        removed.push(pieceId);
        return { position: pos, live: nlive, statuses: nstat, stages: nstages, removed, status: null, boosts: null };
      } else {
        nlive.set(pieceId, { ...current, hp, pristine: false });
      }
    }

    if (toll.status) nstat.set(pieceId, applyRider(nstat.get(pieceId) ?? {}, toll.status));
    if (toll.boosts) {
      const next = applyBoosts(nstages.get(pieceId) ?? {}, toll.boosts);
      if (hasAnyStage(next)) nstages.set(pieceId, next);
      else nstages.delete(pieceId);
    }

    return {
      position: pos, live: nlive, statuses: nstat, stages: nstages, removed,
      status: toll.status, boosts: toll.boosts,
    };
  }

  /**
   * What the attacker pays for its blows, and what the defender's item exacts for contact.
   *
   * Life Orb's tenth and a recoil move's share of the damage dealt both fall on the attacker; Rocky Helmet
   * charges it for touching. Shared by the forecast and the real resolution so the preview cannot lie.
   */
  private recoilInputs(attackerId: number, defenderId: number, slot: number, hitRoll = 0): {
    attackerRecoil?: { ofDamage?: number; ofMaxHp?: number };
    defenderContact?: { ofAttackerMaxHp: number };
    attackerMakesContact?: boolean;
    priority?: number;
    attackerHits?: number;
  } {
    const move = this.movesetOf(attackerId)[slot];
    const ofDamage = move?.recoil;
    const ofMaxHp = attackCostFraction(this.loadoutOf(attackerId).item);
    const punish = contactPunishFraction(this.loadoutOf(defenderId).item);
    const contact = move?.contact === true;

    const recoil = ofDamage !== undefined || ofMaxHp > 0
      ? { ...(ofDamage !== undefined ? { ofDamage } : {}), ...(ofMaxHp > 0 ? { ofMaxHp } : {}) }
      : undefined;

    // A ranged multi-hit count is rolled by the caller and passed in, so the same action always resolves the
    // same way on a replay.
    const hits = move?.hits === undefined
      ? undefined
      : typeof move.hits === 'number'
        ? move.hits
        : move.hits[0] + (hitRoll % (move.hits[1] - move.hits[0] + 1));

    return {
      ...(recoil ? { attackerRecoil: recoil } : {}),
      ...(punish > 0 ? { defenderContact: { ofAttackerMaxHp: punish } } : {}),
      ...(contact ? { attackerMakesContact: true } : {}),
      ...(move?.priority !== undefined ? { priority: move.priority } : {}),
      ...(hits !== undefined ? { attackerHits: hits } : {}),
    };
  }

  /**
   * A synthetic `Move` for a non-board action (an art cast, a Terastallisation).
   *
   * `from === to` is the acting piece's own square, a combination no real chess move produces, so the two
   * kinds can never be confused — and the action list stays a list of encoded numbers.
   */
  private pseudoMoveFor(square: Square, cls: PieceClass, encoded: number): Move {
    return {
      from: square, to: square, cls, captured: null, capturedSquare: null, promotion: null,
      isCapture: false, isEnPassant: false, isDoublePush: false, castle: null, encoded,
    };
  }

  /**
   * Whether casting this art would actually change the field.
   *
   * An action that does nothing must never be offered: re-setting the weather already blowing, or adding a
   * fourth layer of Spikes to a saturated band, would waste a turn and read as a bug.
   */
  private artWouldChangeAnything(art: Art, side: Side, square: Square): boolean {
    if (art.effect.kind === 'weather') {
      return this.field.weather?.kind !== art.effect.weather;
    }
    if (art.effect.kind === 'screen') {
      // Re-raising a screen that is already up would waste the turn.
      return (this.field.screens[side][art.effect.screen] ?? 0) === 0;
    }
    const zone = hazardZone(side, fileOf(square));
    return zone.some((sq) => {
      const at = this.field.hazards.get(sq) ?? {};
      return addHazardLayer(at, art.effect.kind === 'hazard' ? art.effect.hazard : 'spikes') !== at;
    });
  }

  /** The field move a piece can cast, or null. Auto-picked from its species when the loadout omits one. */
  artOf(pieceId: number): Art | null {
    return this.loadoutOf(pieceId).art ?? this.arts.get(pieceId) ?? null;
  }

  /**
   * The type a piece actually fights and defends as right now.
   *
   * Every combat decision — effectiveness, STAB, immunity, hazard tolls, weather chip — must read this rather
   * than the loadout's declared type, because a Terastallised piece has genuinely changed type.
   */
  battleTypeOf(pieceId: number): BattleType {
    const loadout = this.loadoutOf(pieceId);
    return this.tera.has(pieceId) && loadout.teraType ? loadout.teraType : loadout.type;
  }

  /** Whether this piece has Terastallised. */
  hasTerastallised(pieceId: number): boolean {
    return this.tera.has(pieceId);
  }

  /** Whether a side still has its one Terastallisation available. */
  teraAvailable(side: Side): boolean {
    for (const id of this.tera) {
      if (this.pieceById(id)?.side === side) return false;
    }
    // A piece that Terastallised and then fell still spent the side's use, so check the history too.
    return !this.history.some((h) => h.side === side && isTeraMove(h.move.encoded));
  }

  /** The stat stages a piece is carrying, defaulting to all zero. */
  stagesOf(pieceId: number): StatStages {
    return this.stages.get(pieceId) ?? {};
  }

  /**
   * A piece's effective Speed, after its stages.
   *
   * This is the one the Clash orders blows by, which is what makes a Speed drop the sharpest effect in the
   * game: it can flip who swings first, and therefore who survives.
   */
  effectiveSpeed(pieceId: number): number {
    return Math.max(1, Math.round(this.statsOf(pieceId).spe * stageMultiplier(stageOf(this.stagesOf(pieceId), 'spe'))));
  }

  /**
   * The end-of-turn Checkup for one side — the TCG's upkeep, resolved deterministically.
   *
   * Runs on the side that just finished its turn (so residual damage lands on the afflicted piece's own
   * turn). Poison adds a counter and the piece faints at three — a visible three-turn death clock — but
   * a king is never removed by it (the Regicide rule R7): it clamps to 1 HP instead. Burn clears after
   * three of its owner's turns; sleep wakes after its set duration, capped at three; paralysis costs one
   * turn then clears. Timing is by turn count, not coins, so the Checkup is deterministic and needs no
   * randomness of its own.
   */
  private checkup(
    side: Side,
    position: Position,
    live: ReadonlyMap<number, LiveState>,
    statuses: ReadonlyMap<number, PieceStatus>,
    field: Field = this.field,
  ): {
    position: Position;
    live: ReadonlyMap<number, LiveState>;
    statuses: ReadonlyMap<number, PieceStatus>;
    field: Field;
    guards: ReadonlyMap<number, number>;
  } {
    let pos = position;
    const nlive = new Map(live);
    const nstat = new Map(statuses);

    for (const { square, piece } of position.allPieces()) {
      if (piece.side !== side) continue;

      // Sandstorm scratches everything that does not resist it — the field's own upkeep, before items heal.
      const chip = weatherChipFraction(field.weather, this.battleTypeOf(piece.id));
      if (chip > 0) {
        const l = nlive.get(piece.id) ?? this.liveOf(piece.id);
        if (l.hp > 0) {
          const damage = Math.max(1, Math.floor(l.maxHp * chip));
          const isKing = piece.cls === 'king';
          const hp = l.hp - damage;
          if (hp <= 0 && isKing) {
            nlive.set(piece.id, { ...l, hp: 1, pristine: false });
          } else if (hp <= 0) {
            pos = pos.withPieceRemoved(square, false);
            nlive.delete(piece.id);
            nstat.delete(piece.id);
            continue;
          } else {
            nlive.set(piece.id, { ...l, hp, pristine: false });
          }
        }
      }

      // Held-item healing (Leftovers) happens whether or not the piece is afflicted, and never overheals.
      const heal = checkupHealFraction(this.loadoutOf(piece.id).item);
      if (heal > 0) {
        const l = nlive.get(piece.id) ?? this.liveOf(piece.id);
        if (l.hp > 0 && l.hp < l.maxHp) {
          nlive.set(piece.id, { ...l, hp: Math.min(l.maxHp, l.hp + Math.max(1, Math.floor(l.maxHp * heal))) });
        }
      }

      const st = nstat.get(piece.id);
      if (!st) continue;
      let s: PieceStatus = st;

      // Rotation-class conditions age.
      if (s.rotation) {
        const r = s.rotation;
        if (r.kind === 'paralyzed') {
          s = cure(s, 'paralyzed'); // one turn lost, then clear
        } else if (r.kind === 'asleep') {
          const turns = r.turns + 1;
          // `data`-less sleep uses the cap; Rest sets a shorter duration via the rotation's turn target.
          if (turns >= SLEEP_TURN_CAP) s = cure(s, 'asleep');
          else s = { ...s, rotation: { kind: 'asleep', turns } };
        }
        // Confusion clears on a defined event (see §9), not on the counter.
      }

      // Burn ages out after three of the owner's turns.
      if (s.burned) {
        const count = s.burned.count + 1;
        if (count > 3) s = cure(s, 'burned');
        else s = { ...s, burned: { kind: 'burned', count } };
      }

      // Poison accumulates and, at the lethal count, removes the piece — unless it is a king.
      if (s.poisoned) {
        const count = s.poisoned.count + POISON_RATE.poisoned;
        if (count >= POISON_LETHAL_COUNT) {
          if (piece.cls === 'king') {
            // R7: residual damage may bring a king to 1 HP but never removes it. Cap the counter below
            // lethal and clamp its HP to 1.
            s = { ...s, poisoned: { kind: 'poisoned', count: POISON_LETHAL_COUNT - 1 } };
            const l = nlive.get(piece.id) ?? { hp: this.statsOf(piece.id).maxHp, maxHp: this.statsOf(piece.id).maxHp, pristine: true };
            nlive.set(piece.id, { ...l, hp: 1, pristine: false });
          } else {
            pos = pos.withPieceRemoved(square, false);
            nlive.delete(piece.id);
            nstat.delete(piece.id);
            continue;
          }
        } else {
          s = { ...s, poisoned: { kind: 'poisoned', count } };
        }
      }

      if (Object.keys(s).length === 0) nstat.delete(piece.id);
      else nstat.set(piece.id, s);
    }

    // Weather is timed and ages on the side-to-move's Checkup, so five turns means five of its own turns.
    // A match-condition weather (turns Infinity) never runs out.
    const nextWeather = field.weather && Number.isFinite(field.weather.turns)
      ? tickWeather(field.weather)
      : field.weather;

    // A guard lapses at the end of the *opponent's* turn, not its caster's.
    //
    // That is the whole reason it is worth a tempo: Follow Me cast by White has to still be standing when
    // Black replies, or it would protect nothing. So this Checkup — the mover's — ages the other side's
    // guards, having just given them the one enemy turn they were cast to cover. Any guard whose piece has
    // left the board is dropped here too.
    const nguards = new Map<number, number>();
    for (const [id, turns] of this.guards) {
      if (!pos.allPieces().some((p) => p.piece.id === id)) continue;
      const own = this.pieceById(id)?.side === side;
      const left = own ? turns : turns - 1;
      if (left > 0) nguards.set(id, left);
    }

    // The mover's own screens age on its Checkup, so five turns means five of its own.
    return {
      position: pos,
      live: nlive,
      statuses: nstat,
      field: {
        ...field,
        weather: nextWeather,
        screens: { ...field.screens, [side]: tickScreens(field.screens[side]) },
      },
      guards: nguards,
    };
  }

  /**
   * An attack a neighbouring drawer pulled onto itself and shrugged off.
   *
   * Lightning Rod and Storm Drain already grant immunity to the type they draw, so there is nothing to
   * resolve: no Clash happens, no piece moves, no HP changes, and the drawer's Sp. Atk rises. From the
   * attacker's side it is a wasted turn, which is exactly the threat a standing drawer is meant to be.
   */
  private absorbedAttack(
    move: Move,
    side: Side,
    attackerId: number,
    attacker: PokemonLoadout,
    intercept: Interception,
    targetId: number,
    roll: ClashRoll,
    nextRngState: RngState,
  ): { game: PokemonChess; resolved: ResolvedMove } {
    const drawerId = intercept.pieceId;
    const nextStages = new Map(this.stages);
    const boosted = applyBoosts(this.stagesOf(drawerId), DRAW_BOOST);
    if (hasAnyStage(boosted)) nextStages.set(drawerId, boosted);

    const resolved: ResolvedMove = {
      move, side, attacker,
      defender: this.loadoutOf(drawerId), // the drawer is the piece the attack reached
      effectiveness: 0, // absorbed outright, which is what a 0x matchup means everywhere else
      verdict: 'blocked',
      attackerHpAfter: this.liveOf(attackerId).hp,
      defenderHpAfter: this.liveOf(intercept.pieceId).hp,
      attackerMaxHp: this.liveOf(attackerId).maxHp,
      defenderMaxHp: this.liveOf(intercept.pieceId).maxHp,
      crit: false, momentum: roll.momentum, blowCount: 0, blows: [],
      moveName: null, moveType: null, statusInflicted: null, boostsInflicted: DRAW_BOOST, recoilTaken: 0,
      intercepted: {
        pieceId: drawerId, square: intercept.square, kind: 'draw',
        insteadOf: this.loadoutOf(targetId),
        ...(intercept.ability ? { ability: intercept.ability } : {}),
      },
      grantsBonus: false, removed: [], kingCaptured: false,
    };

    const nextPos = this.position.withTurnReturned();
    const up = this.checkup(side, nextPos, this.live, this.statuses, this.field);
    return {
      game: this.next({
        position: up.position, live: up.live, statuses: up.statuses, stages: nextStages, field: up.field,
        guards: up.guards, rngState: nextRngState, pending: null,
      }, resolved),
      resolved,
    };
  }

  /** The guards after an art cast: a guard art marks its caster, any other art leaves them alone. */
  private guardsAfterArt(art: Art, casterId: number, from: ReadonlyMap<number, number>): ReadonlyMap<number, number> {
    if (art.effect.kind !== 'guard') return from;
    const next = new Map(from);
    next.set(casterId, GUARD_TURNS);
    return next;
  }

  /** Whether a piece is currently answering for its neighbours, and for how many more enemy turns. */
  guardTurnsLeft(pieceId: number): number {
    return this.guards.get(pieceId) ?? 0;
  }

  /**
   * Who actually answers an attack on `defenderId`, or null when the attacked piece answers for itself.
   *
   * Checked before a Clash begins, because a Clash is between exactly two pieces and this is the step that
   * decides which two. A drawing ability outranks a cast guard: it is the more specific claim (one type, always
   * on) and it absorbs the attack outright rather than fighting it, so letting a guard pre-empt it would throw
   * away an immunity the defender's side already owned.
   */
  interceptorFor(attackerId: number, defenderId: number): Interception | null {
    const target = this.pieceSquare(defenderId);
    const defenderPiece = this.pieceById(defenderId);
    if (target === null || !defenderPiece) return null;

    const best = this.bestSlotAgainst(attackerId, defenderId);
    const moveType = this.movesetOf(attackerId)[best?.slot ?? 0]?.type ?? this.battleTypeOf(attackerId);

    let guard: Interception | null = null;
    for (const neighbour of KING_MOVES[target] ?? []) {
      const piece = this.position.pieceAt(neighbour);
      // Only an ally of the attacked piece can step in, and never the attacked piece itself.
      if (!piece || piece.side !== defenderPiece.side || piece.id === defenderId) continue;

      if (abilityDraws(this.loadoutOf(piece.id).ability) === moveType) {
        return { pieceId: piece.id, square: neighbour, kind: 'draw', ability: this.loadoutOf(piece.id).ability! };
      }
      // Remember the first guard, but keep looking for a drawer, which outranks it.
      if (guard === null && this.guardTurnsLeft(piece.id) > 0) {
        guard = { pieceId: piece.id, square: neighbour, kind: 'guard' };
      }
    }
    return guard;
  }

  /** The square a piece stands on, or null if it has left the board. */
  pieceSquare(pieceId: number): Square | null {
    for (const { square, piece } of this.position.allPieces()) {
      if (piece.id === pieceId) return square;
    }
    return null;
  }

  /** The four-slot moveset a piece fights with. */
  movesetOf(pieceId: number): Moveset {
    const m = this.movesets.get(pieceId);
    if (!m) throw new Error(`no moveset for piece ${pieceId}`);
    return m;
  }

  /**
   * The slot a piece should attack a defender with, and its effectiveness — the best legal option.
   *
   * "Best" ranks the type outcome (super > neutral > resisted), then higher base power. A slot whose type
   * is immune against the defender is never chosen; if every slot is immune the capture is not offered at
   * all (except against a king, which R6 makes reachable). This is what lets coverage rescue a piece
   * whose declared type cannot touch a defender — Gengar reaching a Dark piece with Sludge Bomb.
   */
  bestSlotAgainst(attackerId: number, defenderId: number): { slot: number; type: BattleType; multiplier: number } | null {
    const moves = this.movesetOf(attackerId);
    const defender = this.loadoutOf(defenderId);
    const isKing = this.pieceById(defenderId)?.cls === 'king';
    const defenderType = this.battleTypeOf(defenderId);
    // A king is never immune (R6), so its ability grants no immunity as a defender either.
    const ability = isKing ? undefined : defender.ability;
    const wonderGuard = ability === WONDER_GUARD;
    let best: { slot: number; type: BattleType; multiplier: number } | null = null;
    for (let slot = 0; slot < moves.length; slot++) {
      const type = moves[slot]!.type;
      let mult = effectiveness(type, defenderType);
      if (mult === 0 && isKing) mult = 1; // R6: a king is never immune as a defender
      // An ability can make the bearer immune to a whole type; Wonder Guard admits only super-effective hits.
      if (abilityGrantsImmunity(ability, type)) mult = 0;
      if (wonderGuard && mult <= 1) mult = 0;
      if (mult === 0) continue;
      const power = moves[slot]!.basePower;
      const score = mult * 1000 + power;
      const bestScore = best ? best.multiplier * 1000 + moves[best.slot]!.basePower : -1;
      if (!best || score > bestScore) best = { slot, type, multiplier: mult };
    }
    return best;
  }

  /**
   * Why an attacker cannot capture a defender, for the board's refusal caption — naming the ability when
   * an ability is the cause (Levitate, Volt Absorb…), otherwise the plain type reason. Returns null when
   * the capture is in fact legal.
   */
  blockedReason(attackerId: number, defenderId: number): string | null {
    // A drawn attack is refused by a *neighbour*, not by the piece being attacked, so blaming the target's own
    // typing would send the player looking in the wrong place for the reason their move is greyed out.
    const drawn = this.interceptorFor(attackerId, defenderId);
    if (drawn?.kind === 'draw') {
      const by = this.loadoutOf(drawn.pieceId);
      const name = this.dex.getSpecies(by.species)?.name ?? by.species;
      return `${name} on ${squareName(drawn.square)} draws it with ${abilityLabel(drawn.ability ?? '')}`;
    }
    if (this.bestSlotAgainst(attackerId, defenderId) !== null) return null;
    const defender = this.loadoutOf(defenderId);
    const ability = defender.ability;
    if (ability === WONDER_GUARD) {
      return `${defender.species}'s Wonder Guard blocks all but a super-effective hit`;
    }
    // If any of the attacker's slots is neutralised by the defender's ability, name it.
    if (ability) {
      for (const slot of this.movesetOf(attackerId)) {
        if (abilityGrantsImmunity(ability, slot.type)) {
          return `${abilityLabel(ability)} makes it immune to ${slot.type}`;
        }
      }
    }
    return `${this.battleTypeOf(attackerId)} and its coverage cannot touch ${this.battleTypeOf(defenderId)}`;
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
    status: PieceStatus;
    stages: StatStages;
  }[] {
    return this.position.allPieces().map(({ square, piece }) => ({
      square,
      piece,
      cls: piece.cls,
      pokemon: this.loadoutOf(piece.id),
      live: this.liveOf(piece.id),
      status: this.statusOf(piece.id),
      stages: this.stagesOf(piece.id),
    }));
  }
}

// Re-exported so consumers can import the common types from the game layer they already use.
export type { SpeciesEntry };
export type { Side } from './board.ts';
export type { PieceStatus } from './status.ts';
export type { StatStages, StatKey } from './stages.ts';
