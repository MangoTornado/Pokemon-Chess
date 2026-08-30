/**
 * Live online matches, held in memory.
 *
 * The engine is pure and a game is a seed plus an ordered action list (SPEC §20.6), so a live match needs
 * to relay only two things: the shared seed both clients draft from, and the growing list of encoded moves.
 * This manager owns the rooms, pairs players, and enforces every invariant a server can: membership, that
 * moves append in order (an optimistic `ply` check that stops double-submits and races), the turn clocks, and
 * — through the injected {@link EngineOps} — that each move is actually **legal** for the side making it. That
 * last one is why matchmaking games are ranked: the server runs the same pure engine the clients do, so a
 * trusted client cannot inflate a rating.
 *
 * It also carries the fixed quick-chat vocabulary, which is an index into a closed list rather than free text,
 * so there is nothing to moderate.
 *
 * In-memory by design: a match is ephemeral, and a single-VM deploy (the Oracle Cloud target) keeps all
 * rooms in one process. Finished and abandoned rooms are pruned so memory does not grow without bound.
 */

import { randomInt } from 'node:crypto';

import type { EngineOps } from './gameValidator.ts';
import { isPlausibleEncodedMove } from '../src/engine/position.ts';

/** How long a room survives its last activity before being pruned. */
const ROOM_TTL_MS = 30 * 60 * 1000;

/** How long a player may sit unmatched in the queue before their room is reclaimed. */
const QUEUE_TTL_MS = 5 * 60 * 1000;

/**
 * How many actions a game must contain before its result is allowed to move ratings.
 *
 * Neither a resignation nor a client-reported outcome can be checked against the board — intent is not derivable
 * from a position — so the only honest guard is to require that a game was actually *played*. Without it, two
 * accounts could queue into each other and have the loser resign immediately, banking real Elo, team XP and two
 * encounter rolls for nothing; the ladder would be decided by whoever scripts the fastest loop.
 *
 * SPEC open question 14 defers anti-cheat "beyond move validation" — win-trading and collusion — and this does
 * not pretend to solve those: two determined players can still trade wins by playing ten real moves first. What
 * it closes is the different and much cheaper hole of banking a result with no game behind it at all. The game
 * still ends normally below this threshold; it simply ends unrated.
 */
const RANKED_MIN_ACTIONS = 10;

/**
 * Each side's total thinking time for the whole game.
 *
 * SPEC §17.10 asks for 60s per turn plus a 3-minute reserve; a single generous budget per side is the same
 * protection with one number to explain and one number to show, and it cannot punish a long
 * super-effective chain (which is one "turn" made of several sub-moves).
 */
const CLOCK_MS = 8 * 60 * 1000;

/**
 * The fixed quick-chat vocabulary.
 *
 * SPEC §17.10 rules out free text between strangers, because this game's audience includes children and
 * unmoderated chat is a liability. A closed phrase list keeps the social warmth — greeting an opponent,
 * conceding a good move, apologising for a slow turn — with nothing to moderate, because nothing arbitrary
 * can be said. The client sends an index into this list, never a string.
 */
export const QUICK_CHAT: readonly string[] = [
  'Hi! Good luck.',
  'Good game!',
  'Nice move.',
  'Ouch — that hurt.',
  'Thinking…',
  'Sorry, slow connection.',
  'Well played.',
  'Close one!',
  'Rematch?',
  'Thanks for the game.',
];

/** One quick-chat line as sent, with who said it. */
export interface ChatLine {
  readonly side: Side;
  readonly name: string;
  /** Index into {@link QUICK_CHAT}. */
  readonly phrase: number;
  readonly at: number;
}

/** How many lines a room keeps, so a long game cannot grow unbounded. */
const CHAT_HISTORY = 20;

/** How long a player must wait between lines, so quick-chat cannot be used to spam. */
const CHAT_COOLDOWN_MS = 3000;

export type Side = 'white' | 'black';
export type RoomStatus = 'waiting' | 'playing' | 'over';

/** Fired once when a game ends, so the caller can settle ratings for a ranked (matchmaking) game. */
export interface EndInfo {
  readonly whiteId: number;
  readonly blackId: number;
  readonly winner: Side | 'draw';
  /** True for matchmaking games (rated); false for private/friendly games. */
  readonly ranked: boolean;
}

export interface RoomPlayer {
  readonly accountId: number;
  readonly name: string;
}

interface Room {
  id: string;
  /** Six-character join code for a private room; null for a matchmaking room. */
  code: string | null;
  /** True for a matchmaking (public) room, so the queue only ever pairs into these. */
  matchmaking: boolean;
  seed: string;
  white: RoomPlayer | null;
  black: RoomPlayer | null;
  actions: number[];
  status: RoomStatus;
  /** Set when the game ends: the winning side, or 'draw'. */
  outcome: Side | 'draw' | null;
  endedBy: 'king-capture' | 'draw' | 'resign' | 'timeout' | null;
  /** Guards the one-time end transition (rating settlement fires exactly once). */
  ended: boolean;
  chat: ChatLine[];
  /** Last time each side said something, for the cooldown. */
  lastChatAt: { white: number; black: number };
  /** Thinking time left per side, in ms. */
  clock: { white: number; black: number };
  /** When the side to move started thinking, for deducting elapsed time. Null while waiting to start. */
  turnStartedAt: number | null;
  /** Whose turn it is, per the engine (a bonus move can keep the same side on the move). */
  turn: Side;
  createdAt: number;
  lastActivity: number;
}

/** The view returned to a client, with the requester's own side resolved. */
export interface RoomView {
  readonly id: string;
  readonly code: string | null;
  readonly seed: string;
  readonly status: RoomStatus;
  readonly white: string | null;
  readonly black: string | null;
  readonly actions: readonly number[];
  readonly outcome: Side | 'draw' | null;
  /** The requesting account's side, or null if they are only watching. */
  readonly you: Side | null;
  /** Thinking time left per side in ms, with the side on the move already debited. */
  readonly clock: { white: number; black: number };
  /** How the game ended, when it did — so the UI can say "on time" rather than just "you lost". */
  readonly endedBy: 'king-capture' | 'draw' | 'resign' | 'timeout' | null;
  /** Recent quick-chat, oldest first. */
  readonly chat: readonly ChatLine[];
}

export type MatchResult<T> = { ok: true; value: T } | { ok: false; error: string; status: number };

const ok = <T>(value: T): MatchResult<T> => ({ ok: true, value });
const fail = (error: string, status = 400): MatchResult<never> => ({ ok: false, error, status });

export class Matches {
  private readonly rooms = new Map<string, Room>();
  /** Room ids by join code, for private games. */
  private readonly byCode = new Map<string, string>();
  /** The single open matchmaking room waiting for a second player, if any. */
  private waitingRoomId: string | null = null;
  private readonly now: () => number;
  private readonly makeId: () => string;
  /** When set, moves are validated against the engine (server-authoritative); else the server relays only. */
  private readonly engine: EngineOps | undefined;
  /** Fired once when a game ends, for rating settlement. */
  private readonly onEnd: ((info: EndInfo) => void) | undefined;

  constructor(
    clock: () => number = () => Date.now(),
    makeId: () => string = defaultId,
    engine?: EngineOps,
    onEnd?: (info: EndInfo) => void,
  ) {
    this.now = clock;
    this.makeId = makeId;
    this.engine = engine;
    this.onEnd = onEnd;
  }

  /** Enters the matchmaking queue: joins a waiting opponent, or opens a room and waits. */
  enqueue(player: RoomPlayer): MatchResult<RoomView> {
    this.prune();
    if (this.waitingRoomId) {
      const room = this.rooms.get(this.waitingRoomId);
      if (room && room.status === 'waiting' && room.white) {
        // The same account re-queuing (a double-click) stays in its existing room rather than orphaning it.
        if (room.white.accountId === player.accountId) return ok(this.view(room, player.accountId));
        // A different player pairs in as Black.
        room.black = player;
        room.status = 'playing';
        room.turnStartedAt = this.now(); // the clock starts now that both players are here
        room.lastActivity = this.now();
        this.waitingRoomId = null;
        return ok(this.view(room, player.accountId));
      }
      // Stale pointer; clear it.
      this.waitingRoomId = null;
    }
    // Otherwise open a new matchmaking room and wait as White.
    const room = this.open(player, null, true);
    this.waitingRoomId = room.id;
    return ok(this.view(room, player.accountId));
  }

  /**
   * Abandons a specific waiting room the caller owns — the private-game counterpart of {@link cancelQueue}.
   *
   * `cancelQueue` only ever looks at the single matchmaking `waitingRoomId`, so a private room's Cancel button
   * closed nothing: the join code stayed live and a friend could walk into a game its creator had already left.
   * Returns false if the room is not the caller's to abandon, or has already started.
   */
  abandon(id: string, accountId: number): boolean {
    const room = this.rooms.get(id);
    if (!room || room.status !== 'waiting') return false;
    if (room.white?.accountId !== accountId) return false;
    this.rooms.delete(id);
    if (room.code) this.byCode.delete(room.code);
    if (this.waitingRoomId === id) this.waitingRoomId = null;
    return true;
  }

  /** Removes the caller from the queue, closing their empty waiting room. */
  cancelQueue(accountId: number): void {
    if (!this.waitingRoomId) return;
    const room = this.rooms.get(this.waitingRoomId);
    if (room && room.white?.accountId === accountId && room.status === 'waiting') {
      this.rooms.delete(room.id);
      this.waitingRoomId = null;
    }
  }

  /** Creates a private room and returns its join code. The creator is White. */
  createPrivate(player: RoomPlayer): MatchResult<RoomView> {
    this.prune();
    let code = this.freshCode();
    const room = this.open(player, code, false);
    this.byCode.set(code, room.id);
    return ok(this.view(room, player.accountId));
  }

  /** Joins a private room by code as Black (or rejoins if already a member). */
  joinByCode(code: string, player: RoomPlayer): MatchResult<RoomView> {
    this.prune();
    const id = this.byCode.get(code.toUpperCase());
    const room = id ? this.rooms.get(id) : undefined;
    if (!room) return fail('No game with that code.', 404);
    if (this.sideOf(room, player.accountId)) return ok(this.view(room, player.accountId)); // reconnect
    // Load-bearing, not defence in depth: without it a code could be used on a finished room, flipping it back to
    // 'playing' while `room.ended` stayed true — and since every ending early-returns on that flag, the
    // resurrected game could then never end again by any route, sitting live until the TTL reaped it.
    if (room.status !== 'waiting') return fail('That game is no longer open.', 409);
    if (room.black) return fail('That game is already full.', 409);
    room.black = player;
    room.status = 'playing';
    room.turnStartedAt = this.now(); // the clock starts now that both players are here
    room.lastActivity = this.now();
    return ok(this.view(room, player.accountId));
  }

  /** The current state of a room for a member or watcher. */
  state(id: string, accountId: number): MatchResult<RoomView> {
    const room = this.rooms.get(id);
    if (!room) return fail('No such game.', 404);
    // Polling is also how a flag-fall is noticed, so charge the clock on read.
    this.chargeClock(room);
    return ok(this.view(room, accountId));
  }

  /**
   * Appends a move. `ply` is the expected action count before this move — the optimistic-concurrency guard
   * that rejects a stale or duplicate submission. Only a seated player may move.
   */
  move(id: string, accountId: number, ply: number, encoded: number): MatchResult<RoomView> {
    const room = this.rooms.get(id);
    if (!room) return fail('No such game.', 404);
    const side = this.sideOf(room, accountId);
    if (!side) return fail('You are not a player in this game.', 403);
    if (room.status !== 'playing') return fail('This game is not in progress.', 409);
    if (!Number.isInteger(ply) || ply !== room.actions.length) {
      return fail('Out-of-date move; refresh and retry.', 409);
    }
    if (!isPlausibleEncodedMove(encoded)) return fail('Malformed move.', 400);
    // A player who has run out of time loses before their move is considered.
    if (this.chargeClock(room) && room.status !== 'playing') return ok(this.view(room, accountId));

    // Server-authoritative check: is this a legal move for this side right now? (Relay-only if no engine.)
    if (this.engine) {
      const verdict = this.engine.validate(room.seed, room.actions, encoded, side);
      if (!verdict.ok) return fail(verdict.error, 409);
      room.actions.push(encoded);
      room.turn = verdict.turn;
      room.turnStartedAt = this.now();
      room.lastActivity = this.now();
      if (verdict.ended) {
        this.finalizeEnd(room, verdict.winner ?? 'draw', verdict.winner === 'draw' ? 'draw' : 'king-capture');
      }
      return ok(this.view(room, accountId));
    }
    room.actions.push(encoded);
    room.turn = side === 'white' ? 'black' : 'white';
    room.turnStartedAt = this.now();
    room.lastActivity = this.now();
    return ok(this.view(room, accountId));
  }

  /**
   * Debits the side on the move for the time they have spent thinking, ending the game if they have run
   * out. Returns true if the clock ran out (the game is then over on time).
   *
   * Called on every read and write of a live room, so a flag-fall is noticed by whoever polls next — no
   * timers, no background loop, which keeps the server a plain request handler.
   */
  private chargeClock(room: Room): boolean {
    if (room.status !== 'playing' || room.turnStartedAt === null) return false;
    const now = this.now();
    const elapsed = Math.max(0, now - room.turnStartedAt);
    const remaining = room.clock[room.turn] - elapsed;
    if (remaining <= 0) {
      room.clock[room.turn] = 0;
      this.finalizeEnd(room, room.turn === 'white' ? 'black' : 'white', 'timeout');
      return true;
    }
    room.clock[room.turn] = remaining;
    room.turnStartedAt = now;
    return false;
  }

  /** Ends the game: the caller resigns, handing the win to the other side. */
  resign(id: string, accountId: number): MatchResult<RoomView> {
    const room = this.rooms.get(id);
    if (!room) return fail('No such game.', 404);
    const side = this.sideOf(room, accountId);
    if (!side) return fail('You are not a player in this game.', 403);
    // A resignation on a finished or unstarted room is not a resignation.
    if (room.status !== 'playing') return fail('This game is not in progress.', 409);
    this.finalizeEnd(room, side === 'white' ? 'black' : 'white', 'resign');
    return ok(this.view(room, accountId));
  }

  /**
   * Records the game's terminal result, reported by a client's authoritative engine (a king capture, a
   * draw). Idempotent — the first report wins, so both clients reporting the same end is harmless.
   */
  reportOutcome(id: string, accountId: number, outcome: Side | 'draw'): MatchResult<RoomView> {
    const room = this.rooms.get(id);
    if (!room) return fail('No such game.', 404);
    if (!this.sideOf(room, accountId)) return fail('You are not a player in this game.', 403);

    // Never take the result from the client when we can work it out ourselves.
    //
    // This used to call finalizeEnd unconditionally, behind a comment claiming a client report was "only a
    // harmless confirmation" once an engine was configured. It was not harmless: finalizeEnd settles ratings, so
    // any seated player in a ranked room could POST their own side as the winner before making a single move and
    // bank real Elo, team XP and an encounter roll. Measured at 1500/1500 -> 1476/1524 off one request.
    //
    // With an engine, `move()` already ends terminal positions itself (see the king-capture branch there), so
    // the report genuinely is redundant — which is what makes ignoring it the right fix rather than a lossy one.
    // The honest client posts its local result once; it now gets the room state back and nothing else happens.
    if (this.engine) return ok(this.view(room, accountId));

    if (room.status !== 'playing') return fail('This game is not in progress.', 409);
    this.finalizeEnd(room, outcome, outcome === 'draw' ? 'draw' : 'king-capture');
    return ok(this.view(room, accountId));
  }

  /** Ends a room exactly once, recording the outcome and firing the rating callback for a ranked game. */
  private finalizeEnd(room: Room, winner: Side | 'draw', by: 'king-capture' | 'draw' | 'resign' | 'timeout' = 'king-capture'): void {
    if (room.ended) return;
    room.ended = true;
    room.status = 'over';
    room.outcome = winner;
    room.endedBy = by;
    room.turnStartedAt = null;
    room.lastActivity = this.now();
    if (room.white && room.black && this.onEnd) {
      // Rate what the server can *prove*. This is the one choke point every ending flows through — resign,
      // flag-fall, king capture, client report — so the rule belongs here rather than in each caller.
      //
      // A flag-fall is proved by the server's own clock and an engine-detected king capture by its own replay, so
      // both rate unconditionally; that keeps abandonment punished, which a blanket action floor would have let
      // players dodge by never moving. A resignation cannot be proved at all (intent is not derivable from a
      // position), and neither can a client-reported ending in relay mode, so those two need a real game behind
      // them before they touch anybody's rating.
      const provable = by === 'timeout'
        || (this.engine !== undefined && (by === 'king-capture' || by === 'draw'));
      const rated = room.matchmaking && (provable || room.actions.length >= RANKED_MIN_ACTIONS);
      this.onEnd({ whiteId: room.white.accountId, blackId: room.black.accountId, winner, ranked: rated });
    }
  }

  /**
   * Says one of the fixed quick-chat lines.
   *
   * Takes an index rather than a string, so nothing a player types can ever reach another player. Rate-limited
   * per side, because a closed vocabulary can still be spammed.
   */
  say(id: string, accountId: number, phrase: unknown): MatchResult<RoomView> {
    const room = this.rooms.get(id);
    if (!room) return fail('No such game.', 404);
    const side = this.sideOf(room, accountId);
    if (!side) return fail('You are not a player in this game.', 403);
    if (!Number.isInteger(phrase)) return fail('Unknown phrase.');
    const index = phrase as number;
    if (index < 0 || index >= QUICK_CHAT.length) return fail('Unknown phrase.');

    const now = this.now();
    if (now - room.lastChatAt[side] < CHAT_COOLDOWN_MS) return fail('One message at a time, please.', 429);
    room.lastChatAt[side] = now;

    const name = (side === 'white' ? room.white : room.black)?.name ?? 'Player';
    room.chat.push({ side, name, phrase: index, at: now });
    if (room.chat.length > CHAT_HISTORY) room.chat.splice(0, room.chat.length - CHAT_HISTORY);
    room.lastActivity = now;
    return ok(this.view(room, accountId));
  }

  /** Rooms currently in memory, for a health check. */
  count(): number {
    return this.rooms.size;
  }

  // --- internals -----------------------------------------------------------

  private open(white: RoomPlayer, code: string | null, matchmaking: boolean): Room {
    const room: Room = {
      id: this.makeId(),
      code,
      matchmaking,
      seed: `mp-${this.makeId()}`,
      white,
      black: null,
      actions: [],
      status: 'waiting',
      outcome: null,
      endedBy: null,
      ended: false,
      chat: [],
      // -Infinity, not 0: with a clock that starts at zero, 0 would read as "just spoke" and silence the
      // first message of the game.
      lastChatAt: { white: -Infinity, black: -Infinity },
      clock: { white: CLOCK_MS, black: CLOCK_MS },
      // The clock starts when the second player arrives, not while waiting for one.
      turnStartedAt: null,
      turn: 'white',
      createdAt: this.now(),
      lastActivity: this.now(),
    };
    this.rooms.set(room.id, room);
    return room;
  }

  private sideOf(room: Room, accountId: number): Side | null {
    if (room.white?.accountId === accountId) return 'white';
    if (room.black?.accountId === accountId) return 'black';
    return null;
  }

  private view(room: Room, accountId: number): RoomView {
    return {
      id: room.id,
      code: room.code,
      seed: room.seed,
      status: room.status,
      white: room.white?.name ?? null,
      black: room.black?.name ?? null,
      actions: room.actions,
      outcome: room.outcome,
      you: this.sideOf(room, accountId),
      clock: { ...room.clock },
      endedBy: room.endedBy,
      chat: [...room.chat],
    };
  }

  private freshCode(): string {
    // Unambiguous alphabet (no O/0, I/1) so a code read aloud is unambiguous.
    //
    // Drawn from `crypto.randomInt`, not `Math.random`: this code is the *only* credential protecting a private
    // room, and V8's Math.random is a recoverable xorshift128+ — observing a couple of codes would let someone
    // predict the next, which is a different and much cheaper attack than guessing one in 32^6.
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let attempt = 0; attempt < 50; attempt++) {
      let code = '';
      for (let i = 0; i < 6; i++) code += alphabet[randomInt(alphabet.length)];
      if (!this.byCode.has(code)) return code;
    }
    // Astronomically unlikely fallback.
    return `R${this.rooms.size}${randomInt(1e6)}`.slice(0, 6).toUpperCase();
  }

  /** Drops rooms that are finished-and-idle or stuck waiting, and their code entries. */
  private prune(): void {
    const t = this.now();
    for (const [id, room] of this.rooms) {
      const idle = t - room.lastActivity;
      const stale = room.status === 'waiting' ? idle > QUEUE_TTL_MS : idle > ROOM_TTL_MS;
      if (stale) {
        this.rooms.delete(id);
        if (room.code) this.byCode.delete(room.code);
        if (this.waitingRoomId === id) this.waitingRoomId = null;
      }
    }
  }
}

function defaultId(): string {
  // A short random id; collisions are handled by Map semantics (a duplicate would overwrite, so keep it wide).
  // Unguessable for the same reason as the join code: a room id is enough to read a game's whole state.
  return `g${Date.now().toString(36)}${randomInt(2 ** 48 - 1).toString(36)}`;
}
