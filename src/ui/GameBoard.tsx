/**
 * The playable board.
 *
 * Three things here are load-bearing rather than decorative:
 *
 * 1. **Outcomes are previewed, not discovered.** Selecting a piece colours every capture it could make by
 *    what that capture would do. The premise of the game is that type knowledge is your edge, and an edge
 *    you cannot see before committing is not an edge.
 * 2. **Refusals are explained in place.** An enemy piece this attacker cannot touch is marked as such
 *    while it is selected. "Why can't I take that?" is the question that makes people quit, and the game
 *    always knows the precise answer.
 * 3. **Every resolution animates distinctly.** The four outcomes must be separable without reading, and
 *    the free extra move — the most consequential thing that happens in this game — must be impossible to
 *    miss.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Dex } from '../data/dex.ts';
import { ALL_SQUARES, rankOf, squareColor, squareName } from '../engine/board.ts';
import type { Square } from '../engine/board.ts';
import { effectiveness } from '../engine/typechart.ts';
import { PokemonChess } from '../engine/variant.ts';
import type { ResolvedMove, VariantMove } from '../engine/variant.ts';
import type { Position } from '../engine/position.ts';
import type { Loadout } from '../engine/variant.ts';
import { BoardPiece } from './BoardPiece.tsx';
import { PokemonIcon } from './PokemonIcon.tsx';
import { OUTCOME_PRESENTATION, RESOLUTION_PRESENTATION, causeLabel, coinString } from './outcomes.ts';
import { ROLE_GLYPH, ROLE_LABEL } from './pieceRoles.ts';
import { TYPE_COLORS, textColorOn } from './typeColors.ts';

/** How long a resolution animation holds the board before it settles. */
const EFFECT_MS = 720;

type EffectKind = 'super' | 'neutral' | 'mutual' | 'denied';

interface SquareEffect {
  readonly square: Square;
  readonly kind: EffectKind;
  /** Distinguishes consecutive effects on the same square so React restarts the animation. */
  readonly nonce: number;
}

export interface GameBoardProps {
  dex: Dex;
  seed: string;
  /**
   * The starting position and Pokémon loadout for the match.
   *
   * Passed in rather than drafted here, so the same board serves the sandbox (armies auto-drafted from
   * the full dex), the draft screen (armies chosen by the player), and later the ranked and tutorial
   * flows. The board itself has no opinion on how the pieces got there.
   */
  setup: { position: Position; loadout: Loadout };
  onLeave: () => void;
}

export function GameBoard({ dex, seed, setup, onLeave }: GameBoardProps) {
  const [game, setGame] = useState(() =>
    PokemonChess.create({ position: setup.position, loadout: setup.loadout, seed }),
  );
  const [selected, setSelected] = useState<Square | null>(null);
  const [effects, setEffects] = useState<readonly SquareEffect[]>([]);
  const [last, setLast] = useState<ResolvedMove | null>(null);
  const nonce = useRef(0);

  // A new seed means a new game, not a new board on an old game.
  useEffect(() => {
    setGame(PokemonChess.create({ position: setup.position, loadout: setup.loadout, seed }));
    setSelected(null);
    setEffects([]);
    setLast(null);
  }, [setup, seed]);

  useEffect(() => {
    if (effects.length === 0) return;
    const timer = setTimeout(() => setEffects([]), EFFECT_MS);
    return () => clearTimeout(timer);
  }, [effects]);

  const legal = useMemo(() => game.legalMoves(), [game]);
  const result = useMemo(() => game.result(), [game]);
  const over = result.kind !== 'playing';

  /** Legal actions for the currently selected piece, keyed by destination. */
  const options = useMemo(() => {
    const map = new Map<Square, VariantMove>();
    if (selected === null) return map;
    for (const option of legal) {
      if (option.move.from === selected) map.set(option.move.to, option);
    }
    return map;
  }, [legal, selected]);

  /** Squares whose occupant the selected piece is forbidden to capture, and why. */
  const denied = useMemo(() => {
    const out = new Map<Square, string>();
    if (selected === null) return out;
    const attackerPiece = game.position.pieceAt(selected);
    if (!attackerPiece) return out;
    const attacker = game.loadoutOf(attackerPiece.id);

    for (const { square, piece } of game.position.allPieces()) {
      if (piece.side === attackerPiece.side) continue;
      const defender = game.loadoutOf(piece.id);
      if (effectiveness(attacker.type, defender.type) === 0) {
        out.set(square, `${attacker.type} cannot touch ${defender.type}`);
      }
    }
    return out;
  }, [game, selected]);

  const movablePieceSquares = useMemo(() => new Set(legal.map((m) => m.move.from)), [legal]);

  const play = useCallback(
    (option: VariantMove) => {
      const { game: next, resolved } = game.play(option.move);
      nonce.current += 1;

      const kind: EffectKind =
        resolved.resolution === 'mutual-destruction'
          ? 'mutual'
          : resolved.resolution === 'capture-and-continue'
            ? 'super'
            : 'neutral';

      const marks: SquareEffect[] = [
        { square: resolved.move.to, kind, nonce: nonce.current },
      ];
      if (resolved.attackerDestroyed) {
        marks.push({ square: resolved.move.from, kind: 'mutual', nonce: nonce.current });
      }

      setEffects(resolved.defender ? marks : []);
      setLast(resolved);
      setGame(next);
      // Keep the piece selected when it has earned another move, so the chain flows without a re-click.
      setSelected(resolved.grantsExtraMove ? resolved.move.to : null);
    },
    [game],
  );

  const onSquare = useCallback(
    (square: Square) => {
      if (over) return;

      const option = options.get(square);
      if (option) {
        play(option);
        return;
      }

      if (denied.has(square)) {
        // Say why, rather than ignoring the click as though nothing were there.
        nonce.current += 1;
        setEffects([{ square, kind: 'denied', nonce: nonce.current }]);
        return;
      }

      if (movablePieceSquares.has(square)) {
        setSelected(square);
        return;
      }
      setSelected(null);
    },
    [denied, movablePieceSquares, options, over, play],
  );

  const effectBySquare = useMemo(() => {
    const map = new Map<Square, SquareEffect>();
    for (const e of effects) map.set(e.square, e);
    return map;
  }, [effects]);

  const pendingExtra = game.extraMovePieceId !== null;
  const rows = [7, 6, 5, 4, 3, 2, 1, 0];

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <StatusBar
        game={game}
        result={result}
        pendingExtra={pendingExtra}
        onLeave={onLeave}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 260px', gap: '1rem', alignItems: 'start' }}>
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
            opacity: over ? 0.75 : 1,
          }}
        >
          {rows.flatMap((rank) =>
            ALL_SQUARES.filter((sq) => rankOf(sq) === rank).map((square) => {
              const piece = game.position.pieceAt(square);
              const pokemon = piece ? game.loadoutOf(piece.id) : null;
              const option = options.get(square);
              const isSelected = square === selected;
              const denial = denied.get(square);
              const effect = effectBySquare.get(square);
              const canMoveHere = option !== undefined;
              const outcome = option?.outcome ?? null;

              const label = piece
                ? `${squareName(square)}: ${piece.side} ${ROLE_LABEL[piece.cls].toLowerCase()}, ${dex.getSpecies(pokemon!.species)?.name ?? pokemon!.species}, ${pokemon!.type} type${
                    outcome ? `. Capture: ${OUTCOME_PRESENTATION[outcome].label}` : ''
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
                    background:
                      squareColor(square) === 'light' ? 'var(--square-light)' : 'var(--square-dark)',
                    display: 'grid',
                    placeItems: 'center',
                    outline: isSelected ? '3px solid #58a6ff' : 'none',
                    outlineOffset: -3,
                  }}
                >
                  {piece && pokemon && (
                    <BoardPiece
                      species={dex.requireSpecies(pokemon.species)}
                      type={pokemon.type}
                      cls={piece.cls}
                      side={piece.side}
                    />
                  )}

                  {/* A quiet destination reads as a dot; a capture reads as a ring in its outcome colour. */}
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
                  {canMoveHere && piece && outcome && (
                    <span
                      aria-hidden
                      style={{
                        position: 'absolute',
                        inset: '2%',
                        borderRadius: 4,
                        boxShadow: `inset 0 0 0 4cqmin ${OUTCOME_PRESENTATION[outcome].color}`,
                        zIndex: 3,
                      }}
                    />
                  )}

                  {/* The refusal marker: this is the answer to "why can't I take that?". */}
                  {denial && (
                    <span
                      aria-hidden
                      title={denial}
                      style={{
                        position: 'absolute',
                        inset: '2%',
                        borderRadius: 4,
                        boxShadow: `inset 0 0 0 4cqmin ${OUTCOME_PRESENTATION.immune.color}`,
                        display: 'grid',
                        placeItems: 'center',
                        zIndex: 3,
                      }}
                    >
                      <span
                        style={{
                          fontSize: '34cqmin',
                          lineHeight: 1,
                          color: OUTCOME_PRESENTATION.immune.color,
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
  onLeave,
}: {
  game: PokemonChess;
  result: ReturnType<PokemonChess['result']>;
  pendingExtra: boolean;
  onLeave: () => void;
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
            style={{
              width: 16,
              height: 16,
              borderRadius: '50%',
              background: turnColor,
              border: '1.5px solid #6b7280',
            }}
          />
          <strong>{game.turn === 'white' ? 'White' : 'Black'} to move</strong>
          {pendingExtra && (
            <span
              style={{
                background: OUTCOME_PRESENTATION.super.color,
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
        </>
      ) : (
        <strong style={{ color: 'var(--accent)' }}>
          {result.kind === 'checkmate'
            ? `Checkmate — ${result.winner === 'white' ? 'White' : 'Black'} wins`
            : result.kind === 'stalemate'
              ? 'Stalemate — draw'
              : `Draw by ${result.reason.replace('-', ' ')}`}
        </strong>
      )}
      <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
        <span style={{ color: 'var(--text-dim)', fontSize: '0.85rem', alignSelf: 'center' }}>
          move {game.position.fullmoveNumber}
        </span>
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

  const captureOptions = [...options.values()].filter((o) => o.outcome !== null);

  return (
    <aside style={{ display: 'grid', gap: '0.75rem' }}>
      {last && <ResolutionCard dex={dex} resolved={last} />}

      <Panel title={selectedPokemon ? 'Selected' : 'Select a piece'}>
        {selectedPiece && selectedPokemon ? (
          <div style={{ display: 'grid', gap: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <PokemonIcon species={dex.requireSpecies(selectedPokemon.species)} />
              <div style={{ display: 'grid' }}>
                <strong style={{ fontSize: '0.9rem' }}>
                  {dex.getSpecies(selectedPokemon.species)?.name ?? selectedPokemon.species}
                </strong>
                <span style={{ color: 'var(--text-dim)', fontSize: '0.78rem' }}>
                  {ROLE_GLYPH[selectedPiece.cls]} {ROLE_LABEL[selectedPiece.cls]}
                </span>
              </div>
              <TypePill type={selectedPokemon.type} />
            </div>
            {captureOptions.length > 0 && (
              <div style={{ display: 'grid', gap: '0.25rem' }}>
                <span style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>
                  Captures available
                </span>
                {captureOptions.map((o) => {
                  const p = OUTCOME_PRESENTATION[o.outcome!];
                  return (
                    <div
                      key={o.move.to}
                      style={{
                        display: 'flex',
                        gap: '0.4rem',
                        alignItems: 'center',
                        fontSize: '0.78rem',
                      }}
                    >
                      <span style={{ color: p.color, fontWeight: 700, minWidth: 26 }}>{p.glyph}</span>
                      <span style={{ color: 'var(--text-dim)' }}>{squareName(o.move.to)}</span>
                      <span style={{ color: p.color }}>{p.label}</span>
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
              const p = RESOLUTION_PRESENTATION[h.resolution];
              return (
                <li
                  key={game.history.length - i}
                  style={{ fontSize: '0.76rem', display: 'flex', gap: '0.35rem' }}
                >
                  <span style={{ color: 'var(--text-dim)', minWidth: 62 }}>
                    {squareName(h.move.from)}→{squareName(h.move.to)}
                  </span>
                  <span style={{ color: p.color }}>{p.label}</span>
                  {h.crit?.isCrit && (
                    <span style={{ color: OUTCOME_PRESENTATION.super.color }} title="critical hit">
                      crit
                    </span>
                  )}
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
  const p = RESOLUTION_PRESENTATION[resolved.resolution];
  const cause = causeLabel(resolved.cause, resolved.crit);
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
        {resolved.crit && (
          <span
            aria-label={`coins: ${resolved.crit.coins.filter(Boolean).length} heads of ${resolved.crit.coins.length}`}
            title="A critical hit needs every coin to come up heads"
            style={{
              marginLeft: 'auto',
              display: 'inline-flex',
              gap: '0.15rem',
              letterSpacing: '0.05em',
              color: resolved.crit.isCrit ? OUTCOME_PRESENTATION.super.color : 'var(--text-dim)',
            }}
          >
            {coinString(resolved.crit)}
          </span>
        )}
      </div>
      <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>
        {resolved.attacker && resolved.defender ? (
          <>
            {dex.getSpecies(resolved.attacker.species)?.name} ({resolved.attacker.type}) vs{' '}
            {dex.getSpecies(resolved.defender.species)?.name} ({resolved.defender.type})
            {resolved.multiplier !== null && ` · ${resolved.multiplier}×`}
          </>
        ) : (
          p.detail
        )}
      </div>
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
