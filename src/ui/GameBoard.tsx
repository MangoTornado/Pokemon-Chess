/**
 * The playable board.
 *
 * Four things here are load-bearing rather than decorative:
 *
 * 1. **Outcomes are previewed, not discovered.** Selecting a piece forecasts every capture it could make
 *    — the verdict it would reach at representative luck — and colours the board by it. Type knowledge is
 *    the player's edge, and an edge you cannot see before committing is not an edge.
 * 2. **Refusals are explained in place.** An enemy piece the selected attacker cannot touch is marked and
 *    captioned. "Why can't I take that?" is the question that makes people quit, and the game always knows
 *    the answer.
 * 3. **HP is visible.** Every piece carries a hit-point bar, because a capture is now an exchange of blows
 *    a piece can survive, and a wounded piece is a real state the player must read.
 * 4. **Each verdict animates distinctly**, by motion and not by hue alone, and the bonus move a
 *    super-effective knockout grants — the most consequential event in the game — is impossible to miss.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Dex } from '../data/dex.ts';
import { ALL_SQUARES, rankOf, squareColor, squareName } from '../engine/board.ts';
import type { Square } from '../engine/board.ts';
import { PokemonChess } from '../engine/variant.ts';
import type { ResolvedMove, Side, Verdict, VariantMove } from '../engine/variant.ts';
import type { Position } from '../engine/position.ts';
import type { Loadout } from '../engine/variant.ts';
import { chooseMove } from '../ai/search.ts';
import type { Difficulty } from '../ai/search.ts';
import { replay } from '../game/replay.ts';
import { BoardPiece } from './BoardPiece.tsx';
import { PokemonIcon } from './PokemonIcon.tsx';
import { TIER_PRESENTATION, VERDICT_PRESENTATION, tierOf, verdictCause } from './outcomes.ts';
import { ROLE_GLYPH, ROLE_LABEL } from './pieceRoles.ts';
import { TYPE_COLORS, textColorOn } from './typeColors.ts';

/** How long a resolution animation holds the board before it settles. */
const EFFECT_MS = 760;

type EffectKind = 'advantage' | 'capture' | 'mutual' | 'rout' | 'repel' | 'denied';

interface SquareEffect {
  readonly square: Square;
  readonly kind: EffectKind;
  readonly nonce: number;
}

/** The board-effect class for a resolved verdict; the CSS animations are keyed on it. */
function effectOf(verdict: Verdict): EffectKind {
  switch (verdict) {
    case 'advantage':
      return 'advantage';
    case 'mutual':
      return 'mutual';
    case 'rout':
      return 'rout';
    case 'repel':
      return 'repel';
    default:
      return 'capture';
  }
}

export interface GameBoardProps {
  dex: Dex;
  seed: string;
  setup: { position: Position; loadout: Loadout };
  onLeave: () => void;
  /** When set, the AI controls this side and plays automatically on its turn. */
  ai?: { side: Side; difficulty: Difficulty };
  /**
   * Tutorial hook: restrict the offered actions to those passing this predicate. Denials are unaffected,
   * so an immune target still shows its refusal — which is how the "untouchable" lesson works.
   */
  allow?: (move: VariantMove) => boolean;
  /** Tutorial hook: fired after every resolved move, with the resulting game, for goal detection. */
  onResolved?: (resolved: ResolvedMove, next: PokemonChess) => void;
  /** Tutorial hook: fired when the player clicks a refused (immune) square. */
  onDenied?: (square: Square) => void;
  /** Fired once when the game ends, with the terminal result — the ladder uses it to record a match. */
  onGameOver?: (result: ReturnType<PokemonChess['result']>) => void;
  /** Hide the leave button (the tutorial owns its own navigation). */
  hideLeave?: boolean;
  /**
   * Online play. When set, the server's action list is the source of truth: the board is derived by
   * replaying `actions`, the local player controls `side` only, and a legal move is reported through
   * `onLocalMove` rather than applied locally — the move returns as a new action. The opponent's label is
   * shown while it is their turn.
   */
  controlled?: {
    side: Side;
    actions: readonly number[];
    opponentName: string;
    onLocalMove: (encoded: number, plyBefore: number) => void;
  };
}

export function GameBoard({
  dex, seed, setup, onLeave, ai, allow, onResolved, onDenied, onGameOver, hideLeave, controlled,
}: GameBoardProps) {
  const [localGame, setLocalGame] = useState(() =>
    PokemonChess.create({ dex, position: setup.position, loadout: setup.loadout, seed }),
  );
  const [selected, setSelected] = useState<Square | null>(null);
  const [effects, setEffects] = useState<readonly SquareEffect[]>([]);
  const [last, setLast] = useState<ResolvedMove | null>(null);
  const nonce = useRef(0);

  // In controlled (online) mode the game is a pure replay of the shared action list; in local mode it is
  // the mutated state above.
  const controlledView = useMemo(
    () => (controlled ? replay(dex, setup, seed, controlled.actions) : null),
    [controlled, dex, setup, seed],
  );
  const game = controlled ? controlledView!.game : localGame;

  useEffect(() => {
    setLocalGame(PokemonChess.create({ dex, position: setup.position, loadout: setup.loadout, seed }));
    setSelected(null);
    setEffects([]);
    setLast(null);
    reportedOver.current = false;
    appliedPly.current = 0;
  }, [dex, setup, seed]);

  useEffect(() => {
    if (effects.length === 0) return;
    const timer = setTimeout(() => setEffects([]), EFFECT_MS);
    return () => clearTimeout(timer);
  }, [effects]);

  // In controlled mode, animate whichever move most recently landed (mine or the opponent's) as the
  // action list grows, so an arriving move gets the same capture animation a local move would.
  const appliedPly = useRef(0);
  useEffect(() => {
    if (!controlled) return;
    const n = controlled.actions.length;
    if (n > appliedPly.current) {
      const r = controlledView?.last;
      if (r) {
        nonce.current += 1;
        const marks: SquareEffect[] = [];
        if (r.defender) {
          marks.push({ square: r.move.to, kind: effectOf(r.verdict), nonce: nonce.current });
          if (r.verdict === 'mutual') marks.push({ square: r.move.from, kind: 'mutual', nonce: nonce.current });
        }
        setEffects(marks);
        setLast(r);
      }
      setSelected(null);
    }
    appliedPly.current = n;
  }, [controlled, controlledView]);

  const legal = useMemo(() => {
    const all = game.legalMoves();
    return allow ? all.filter(allow) : all;
  }, [game, allow]);
  const result = useMemo(() => game.result(), [game]);
  const over = result.kind !== 'playing';

  // Report the terminal result exactly once, when the game first ends.
  const reportedOver = useRef(false);
  useEffect(() => {
    if (over && !reportedOver.current) {
      reportedOver.current = true;
      onGameOver?.(result);
    }
  }, [over, result, onGameOver]);

  const options = useMemo(() => {
    const map = new Map<Square, VariantMove>();
    if (selected === null) return map;
    for (const option of legal) {
      if (option.move.from === selected) map.set(option.move.to, option);
    }
    return map;
  }, [legal, selected]);

  const denied = useMemo(() => {
    const out = new Map<Square, string>();
    if (selected === null) return out;
    const attackerPiece = game.position.pieceAt(selected);
    if (!attackerPiece) return out;
    const attacker = game.loadoutOf(attackerPiece.id);

    for (const { square, piece } of game.position.allPieces()) {
      if (piece.side === attackerPiece.side) continue;
      // A king is never immune (R6).
      if (piece.cls === 'king') continue;
      // Untouchable only if NO slot — melee or coverage — can hurt it. Coverage may reach what the
      // declared type cannot, so this asks the engine rather than the declared type alone.
      if (game.bestSlotAgainst(attackerPiece.id, piece.id) === null) {
        const defender = game.loadoutOf(piece.id);
        out.set(square, `${attacker.type} and its coverage cannot touch ${defender.type}`);
      }
    }
    return out;
  }, [game, selected]);

  const movablePieceSquares = useMemo(() => new Set(legal.map((m) => m.move.from)), [legal]);

  const play = useCallback(
    (option: VariantMove) => {
      // Online: report the move to the server rather than applying it — it returns as a new action, and the
      // replay effect above renders and animates it, keeping both clients in lockstep with the server.
      if (controlled) {
        controlled.onLocalMove(option.move.encoded, controlled.actions.length);
        setSelected(null);
        return;
      }
      const { game: next, resolved } = game.play(option.move);
      nonce.current += 1;

      const marks: SquareEffect[] = [];
      if (resolved.defender) {
        marks.push({ square: resolved.move.to, kind: effectOf(resolved.verdict), nonce: nonce.current });
        // Mutual and rout also destroy the attacker's origin/target square; mark the vacated square.
        if (resolved.verdict === 'mutual') {
          marks.push({ square: resolved.move.from, kind: 'mutual', nonce: nonce.current });
        }
      }

      setEffects(marks);
      setLast(resolved);
      setLocalGame(next);
      setSelected(resolved.grantsBonus ? resolved.move.to : null);
      onResolved?.(resolved, next);
    },
    [game, onResolved, controlled],
  );

  const onSquare = useCallback(
    (square: Square) => {
      if (over) return;
      // Not the human's turn while the AI is thinking.
      if (ai !== undefined && game.turn === ai.side) return;
      // Online: only act on your own turn, and never touch the board as a spectator.
      if (controlled && game.turn !== controlled.side) return;

      const option = options.get(square);
      if (option) {
        play(option);
        return;
      }

      if (denied.has(square)) {
        nonce.current += 1;
        setEffects([{ square, kind: 'denied', nonce: nonce.current }]);
        onDenied?.(square);
        return;
      }

      if (movablePieceSquares.has(square)) {
        setSelected(square);
        return;
      }
      setSelected(null);
    },
    [ai, game, denied, movablePieceSquares, options, over, play, onDenied, controlled],
  );

  // When the AI is on the move, compute and play its move after a short beat — so the human's move
  // renders and its animation is seen first, and so the board never appears frozen while it thinks.
  // A seed derived from the move count keeps the AI's play reproducible for a given game.
  useEffect(() => {
    if (!ai || controlled || over || game.turn !== ai.side) return;
    const timer = setTimeout(() => {
      const choice = chooseMove(game, ai.difficulty, game.history.length + 1);
      if (!choice) return;
      const target = game.legalMoves().find((m) => m.move.encoded === choice.move.encoded);
      if (target) play(target);
    }, effects.length > 0 ? EFFECT_MS + 60 : 220);
    return () => clearTimeout(timer);
  }, [ai, controlled, over, game, effects.length, play]);

  const effectBySquare = useMemo(() => {
    const map = new Map<Square, SquareEffect>();
    for (const e of effects) map.set(e.square, e);
    return map;
  }, [effects]);

  const waitingForOpponent = controlled !== undefined && game.turn !== controlled.side && !over;
  const humanBlocked = (ai !== undefined && game.turn === ai.side && !over) || waitingForOpponent;
  const pendingExtra = game.extraMovePieceId !== null;
  // R8: warn when the side to move's king can be taken right now.
  const kingInDanger = useMemo(() => game.kingInDanger(game.turn), [game]);
  const rows = [7, 6, 5, 4, 3, 2, 1, 0];

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <StatusBar
        game={game}
        result={result}
        pendingExtra={pendingExtra}
        kingInDanger={kingInDanger}
        thinking={humanBlocked}
        aiName={ai?.difficulty.name ?? (waitingForOpponent ? controlled?.opponentName : undefined)}
        onLeave={onLeave}
        hideLeave={hideLeave}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 268px', gap: '1rem', alignItems: 'start' }}>
        <div
          role="grid"
          aria-label="Pokémon Chess board"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(8, minmax(0, 1fr))',
            border: '2px solid var(--border)',
            borderRadius: 10,
            overflow: 'hidden',
            aspectRatio: '1 / 1',
            maxWidth: 620,
            opacity: over ? 0.8 : 1,
          }}
        >
          {rows.flatMap((rank) =>
            ALL_SQUARES.filter((sq) => rankOf(sq) === rank).map((square) => {
              const piece = game.position.pieceAt(square);
              const pokemon = piece ? game.loadoutOf(piece.id) : null;
              const live = piece ? game.liveOf(piece.id) : null;
              const status = piece ? game.statusOf(piece.id) : null;
              const option = options.get(square);
              const isSelected = square === selected;
              const denial = denied.get(square);
              const effect = effectBySquare.get(square);
              const canMoveHere = option !== undefined;
              const tier = option?.effectiveness != null ? tierOf(option.effectiveness) : null;

              const label = piece && pokemon && live
                ? `${squareName(square)}: ${piece.side} ${ROLE_LABEL[piece.cls].toLowerCase()}, ${dex.getSpecies(pokemon.species)?.name ?? pokemon.species}, ${pokemon.type} type, ${live.hp} of ${live.maxHp} HP${
                    tier ? `. Capture forecast: ${TIER_PRESENTATION[tier].label}` : ''
                  }${denial ? `. Cannot be captured: ${denial}` : ''}`
                : `${squareName(square)}: empty${canMoveHere ? '. Legal move' : ''}`;

              return (
                <button
                  key={square}
                  type="button"
                  onClick={() => onSquare(square)}
                  aria-label={label}
                  className={effect ? `pc-effect pc-effect-${effect.kind}` : undefined}
                  data-nonce={effect?.nonce}
                  style={{
                    position: 'relative',
                    border: 'none',
                    padding: 0,
                    containerType: 'size',
                    cursor: canMoveHere || movablePieceSquares.has(square) ? 'pointer' : 'default',
                    background: squareColor(square) === 'light' ? 'var(--square-light)' : 'var(--square-dark)',
                    display: 'grid',
                    placeItems: 'center',
                    outline: isSelected ? '3px solid #58a6ff' : 'none',
                    outlineOffset: -3,
                  }}
                >
                  {piece && pokemon && live && (
                    <BoardPiece
                      species={dex.requireSpecies(pokemon.species)}
                      type={pokemon.type}
                      cls={piece.cls}
                      side={piece.side}
                      hp={live.hp}
                      maxHp={live.maxHp}
                      {...(status ? { status } : {})}
                    />
                  )}

                  {canMoveHere && !piece && (
                    <span
                      aria-hidden
                      style={{
                        position: 'absolute',
                        width: '22cqmin',
                        height: '22cqmin',
                        borderRadius: '50%',
                        background: 'rgba(88,166,255,0.75)',
                        boxShadow: '0 0 0 2cqmin rgba(0,0,0,0.15)',
                      }}
                    />
                  )}
                  {canMoveHere && piece && tier && (
                    <span
                      aria-hidden
                      style={{
                        position: 'absolute',
                        inset: '2%',
                        borderRadius: 4,
                        boxShadow: `inset 0 0 0 4cqmin ${TIER_PRESENTATION[tier].color}`,
                        zIndex: 3,
                      }}
                    />
                  )}

                  {denial && (
                    <span
                      aria-hidden
                      title={denial}
                      style={{
                        position: 'absolute',
                        inset: '2%',
                        borderRadius: 4,
                        boxShadow: `inset 0 0 0 4cqmin ${TIER_PRESENTATION.immune.color}`,
                        display: 'grid',
                        placeItems: 'center',
                        zIndex: 3,
                      }}
                    >
                      <span
                        style={{
                          fontSize: '34cqmin',
                          lineHeight: 1,
                          color: TIER_PRESENTATION.immune.color,
                          textShadow: '0 1px 3px rgba(0,0,0,0.8)',
                          fontWeight: 700,
                        }}
                      >
                        ⊘
                      </span>
                    </span>
                  )}
                </button>
              );
            }),
          )}
        </div>

        <SidePanel dex={dex} game={game} last={last} selected={selected} options={options} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function StatusBar({
  game,
  result,
  pendingExtra,
  kingInDanger,
  thinking,
  aiName,
  onLeave,
  hideLeave,
}: {
  game: PokemonChess;
  result: ReturnType<PokemonChess['result']>;
  pendingExtra: boolean;
  kingInDanger: boolean;
  thinking: boolean;
  aiName: string | undefined;
  onLeave: () => void;
  hideLeave?: boolean | undefined;
}) {
  const turnColor = game.turn === 'white' ? '#f6f4ef' : '#15171c';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.85rem',
        flexWrap: 'wrap',
        background: 'var(--bg-raised)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '0.6rem 0.85rem',
      }}
    >
      {result.kind === 'playing' ? (
        <>
          <span
            aria-hidden
            style={{ width: 16, height: 16, borderRadius: '50%', background: turnColor, border: '1.5px solid #6b7280' }}
          />
          <strong>{game.turn === 'white' ? 'White' : 'Black'} to move</strong>
          {thinking && (
            <span style={{ color: 'var(--text-dim)', fontSize: '0.82rem', fontStyle: 'italic' }}>
              {aiName ?? 'AI'} is thinking…
            </span>
          )}
          {pendingExtra && (
            <span
              style={{
                background: VERDICT_PRESENTATION.advantage.color,
                color: '#08210e',
                fontWeight: 750,
                padding: '0.15rem 0.55rem',
                borderRadius: 999,
                fontSize: '0.8rem',
              }}
            >
              ↻ Super effective — move again
            </span>
          )}
          {kingInDanger && (
            <span
              style={{
                background: TIER_PRESENTATION.immune.color,
                color: '#2a0606',
                fontWeight: 800,
                padding: '0.15rem 0.55rem',
                borderRadius: 999,
                fontSize: '0.8rem',
              }}
            >
              ⚠ Your king can be taken
            </span>
          )}
        </>
      ) : (
        <strong style={{ color: 'var(--accent)' }}>
          {result.kind === 'win'
            ? `${result.winner === 'white' ? 'White' : 'Black'} wins — king captured`
            : `Draw by ${result.reason.replace(/-/g, ' ')}`}
        </strong>
      )}
      <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <span style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>move {game.position.fullmoveNumber}</span>
        {!hideLeave && (
          <button
            type="button"
            onClick={onLeave}
            style={{
              background: 'var(--accent)',
              color: '#1a1500',
              border: 'none',
              borderRadius: 6,
              padding: '0.35rem 0.8rem',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Leave match
          </button>
        )}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------

function SidePanel({
  dex,
  game,
  last,
  selected,
  options,
}: {
  dex: Dex;
  game: PokemonChess;
  last: ResolvedMove | null;
  selected: Square | null;
  options: ReadonlyMap<Square, VariantMove>;
}) {
  const selectedPiece = selected === null ? null : game.position.pieceAt(selected);
  const selectedPokemon = selectedPiece ? game.loadoutOf(selectedPiece.id) : null;
  const selectedLive = selectedPiece ? game.liveOf(selectedPiece.id) : null;
  const captureOptions = [...options.values()].filter((o) => o.effectiveness !== null);

  return (
    <aside style={{ display: 'grid', gap: '0.75rem' }}>
      {last && <ResolutionCard dex={dex} resolved={last} />}

      <Panel title={selectedPokemon ? 'Selected' : 'Select a piece'}>
        {selectedPiece && selectedPokemon && selectedLive ? (
          <div style={{ display: 'grid', gap: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <PokemonIcon species={dex.requireSpecies(selectedPokemon.species)} />
              <div style={{ display: 'grid' }}>
                <strong style={{ fontSize: '0.9rem' }}>
                  {dex.getSpecies(selectedPokemon.species)?.name ?? selectedPokemon.species}
                </strong>
                <span style={{ color: 'var(--text-dim)', fontSize: '0.78rem' }}>
                  {ROLE_GLYPH[selectedPiece.cls]} {ROLE_LABEL[selectedPiece.cls]} · {selectedLive.hp}/
                  {selectedLive.maxHp} HP
                </span>
              </div>
              <TypePill type={selectedPokemon.type} />
            </div>
            {captureOptions.length > 0 && (
              <div style={{ display: 'grid', gap: '0.25rem' }}>
                <span style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>Captures available</span>
                {captureOptions.map((o) => {
                  const p = TIER_PRESENTATION[tierOf(o.effectiveness!)];
                  const v = VERDICT_PRESENTATION[o.forecast];
                  return (
                    <div key={o.move.to} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.76rem' }}>
                      <span style={{ color: p.color, fontWeight: 700, minWidth: 24 }}>{p.glyph}</span>
                      <span style={{ color: 'var(--text-dim)', minWidth: 24 }}>{squareName(o.move.to)}</span>
                      <span style={{ color: v.color }}>{v.label}</span>
                      {o.moveName && <span style={{ color: 'var(--text-dim)', marginLeft: 'auto' }}>{o.moveName}</span>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <p style={{ margin: 0, color: 'var(--text-dim)', fontSize: '0.82rem' }}>
            Click one of your pieces. Captures are colour-coded by what they would do, and pieces you
            cannot touch are marked ⊘.
          </p>
        )}
      </Panel>

      <Panel title="Recent">
        {game.history.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--text-dim)', fontSize: '0.82rem' }}>No moves yet.</p>
        ) : (
          <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '0.2rem' }}>
            {game.history.slice(-7).reverse().map((h, i) => {
              const p = VERDICT_PRESENTATION[h.verdict];
              return (
                <li key={game.history.length - i} style={{ fontSize: '0.76rem', display: 'flex', gap: '0.35rem' }}>
                  <span style={{ color: 'var(--text-dim)', minWidth: 62 }}>
                    {squareName(h.move.from)}→{squareName(h.move.to)}
                  </span>
                  <span style={{ color: p.color }}>{p.label}</span>
                  {h.crit && <span style={{ color: VERDICT_PRESENTATION.advantage.color }}>crit</span>}
                </li>
              );
            })}
          </ol>
        )}
      </Panel>
    </aside>
  );
}

function ResolutionCard({ dex, resolved }: { dex: Dex; resolved: ResolvedMove }) {
  const p = VERDICT_PRESENTATION[resolved.verdict];
  const cause = verdictCause(resolved.verdict, resolved.crit, resolved.momentum);
  return (
    <div
      style={{
        background: 'var(--bg-raised)',
        border: `1px solid ${p.color}`,
        borderLeft: `4px solid ${p.color}`,
        borderRadius: 8,
        padding: '0.6rem 0.75rem',
        display: 'grid',
        gap: '0.3rem',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
        <span style={{ color: p.color, fontWeight: 800 }}>{p.glyph}</span>
        <strong style={{ color: p.color, fontSize: '0.88rem' }}>{p.label}</strong>
        {resolved.kingCaptured && (
          <span style={{ marginLeft: 'auto', color: 'var(--accent)', fontWeight: 800, fontSize: '0.78rem' }}>
            king taken
          </span>
        )}
      </div>
      {resolved.defender && (
        <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>
          {dex.getSpecies(resolved.attacker.species)?.name} ({resolved.attacker.type}
          {resolved.attackerHpAfter > 0 ? `, ${resolved.attackerHpAfter}/${resolved.attackerMaxHp} HP` : ', fainted'})
          {' vs '}
          {dex.getSpecies(resolved.defender.species)?.name} ({resolved.defender.type}
          {resolved.defenderHpAfter > 0 ? `, ${resolved.defenderHpAfter}/${resolved.defenderMaxHp} HP` : ', fainted'})
          {resolved.effectiveness !== null && ` · ${resolved.effectiveness}×`}
        </div>
      )}
      {cause && <div style={{ fontSize: '0.74rem', color: 'var(--text-dim)' }}>{cause}</div>}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        background: 'var(--bg-raised)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '0.6rem 0.75rem',
        display: 'grid',
        gap: '0.4rem',
      }}
    >
      <h2 style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-dim)' }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function TypePill({ type }: { type: Parameters<typeof textColorOn>[0] }) {
  return (
    <span
      style={{
        marginLeft: 'auto',
        background: TYPE_COLORS[type],
        color: textColorOn(type),
        padding: '0.1rem 0.45rem',
        borderRadius: 999,
        fontSize: '0.68rem',
        fontWeight: 800,
        textTransform: 'uppercase',
      }}
    >
      {type}
    </span>
  );
}
