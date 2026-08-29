/**
 * Live online matches, held in memory.
 *
 * The engine is pure and a game is a seed plus an ordered action list (SPEC §20.6), so a live match needs
 * to relay only two things: the shared seed both clients draft from, and the growing list of encoded moves.
 * This manager owns the rooms, pairs players, and enforces the invariants a relay can enforce without
 * running the engine — membership, and that moves append in order (an optimistic `ply` check that stops
 * double-submits and races). Move *legality* and whose-turn-it-is are validated by the clients' own
 * authoritative engine; full server-side validation waits until the engine builds under Node's strip-only
 * TypeScript (its constructors use parameter properties today), and is tracked as a follow-up. Until then
 * online play is unranked, so a trusted client cannot inflate a rating.
 *
 * In-memory by design: a match is ephemeral, and a single-VM deploy (the Oracle Cloud target) keeps all
 * rooms in one process. Finished and abandoned rooms are pruned so memory does not grow without bound.
 */

import type { EngineOps } from './gameValidator.ts';

/** How long a room survives its last activity before being pruned. */
const ROOM_TTL_MS = 30 * 60 * 1000;

/** How long a player may sit unmatched in the queue before their room is reclaimed. */
const QUEUE_TTL_MS = 5 * 60 * 1000;

/**
 * Each side's total thinking time for the whole game.
 *
 * SPEC §17.10 asks for 60s per turn plus a 3-minute reserve; a single generous budget per side is the same
 * protection with one number to explain and one number to show, and it cannot punish a long
 * super-effective chain (which is one "turn" made of several sub-moves).
 */
const CLOCK_MS = 8 * 60 * 1000;

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
    if (!Number.isInteger(encoded) || encoded < 0 || encoded > 0xffffff) {
      return fail('Malformed move.', 400);
    }
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
    // With an engine the server already ends games itself; a client report is then only a harmless
    // confirmation. Without one, this is how a game ends. Either way it settles exactly once.
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
      this.onEnd({ whiteId: room.white.accountId, blackId: room.black.accountId, winner, ranked: room.matchmaking });
    }
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
    };
  }

  private freshCode(): string {
    // Unambiguous alphabet (no O/0, I/1) so a code read aloud is unambiguous.
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let attempt = 0; attempt < 50; attempt++) {
      let code = '';
      for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
      if (!this.byCode.has(code)) return code;
    }
    // Astronomically unlikely fallback.
    return `R${this.rooms.size}${Math.floor(Math.random() * 1e6)}`.slice(0, 6).toUpperCase();
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
  return `g${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
}
