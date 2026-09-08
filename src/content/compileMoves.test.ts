import { describe, expect, it } from 'vitest';

import { Dex } from '../data/dex.ts';
import { STATELESS_OPS } from './isa.ts';
import type { CompiledEntry, Op } from './isa.ts';
import { compileAllMoves, compileMove } from './compileMoves.ts';

const dex = await Dex.load();
const compiled = compileAllMoves(dex.moves);
const byId = new Map(compiled.map((c) => [c.id, c]));

function move(id: string): CompiledEntry {
  const c = byId.get(id);
  if (!c) throw new Error(`move ${id} not compiled`);
  return c;
}

function opsOf(entry: CompiledEntry): Op['op'][] {
  return entry.effects.flatMap((e) => e.ops.map((o) => o.op));
}

function marksOf(entry: CompiledEntry): string[] {
  return entry.effects.flatMap((e) =>
    e.ops.filter((o): o is Extract<Op, { op: 'MARK' }> => o.op === 'MARK').map((o) => o.mark),
  );
}

describe('total coverage — every move resolves to something coherent', () => {
  it('compiles all 950 moves', () => {
    expect(compiled).toHaveLength(dex.moves.length);
    expect(compiled.length).toBeGreaterThan(900);
  });

  it('never leaves a move with an undefined effect list', () => {
    for (const c of compiled) {
      expect(Array.isArray(c.effects)).toBe(true);
      expect(c.summary.length).toBeGreaterThan(0);
    }
  });

  it('never falls through to a generic fallback by accident', () => {
    // The fallback provenance should not appear at all: a move is either derived from fields, classified
    // from its handlers, curated, or deliberately inert. If this count is ever non-zero, a move slipped
    // through the derivation unhandled and the summary is a guess.
    const fell = compiled.filter((c) => c.provenance === 'fallback');
    expect(fell.map((c) => c.id)).toEqual([]);
  });

  it('reports a provenance breakdown dominated by field derivation', () => {
    const tally: Record<string, number> = {};
    for (const c of compiled) tally[c.provenance] = (tally[c.provenance] ?? 0) + 1;
    // The FIELDS pass should carry the clear majority; curation stays small.
    expect(tally['fields'] ?? 0).toBeGreaterThan(compiled.length * 0.5);
    expect(tally['curated'] ?? 0).toBeLessThan(60);
  });

  it('gives every damaging move a way to deal damage', () => {
    for (const c of compiled) {
      const m = dex.getMove(c.id)!;
      if (m.category === 'Status') continue;
      const ops = opsOf(c);
      // A damaging move must either resolve a Clash (melee) or STRIKE (ranged/area) or invoke another
      // move (Metronome-likes).
      expect(ops.includes('CLASH') || ops.includes('STRIKE') || ops.includes('INVOKE')).toBe(true);
    }
  });
});

describe('the ISA invariants hold across every compiled move', () => {
  it('never emits a piece-creating op — the termination monovariant', () => {
    for (const c of compiled) {
      for (const op of opsOf(c)) {
        expect(op).not.toBe('SUMMON');
      }
    }
  });

  it('keeps INVOKE depth at exactly 1, so recursion is unconstructible', () => {
    for (const c of compiled) {
      for (const e of c.effects) {
        for (const op of e.ops) {
          if (op.op === 'INVOKE') expect(op.depth).toBe(1);
        }
      }
    }
  });

  it('uses only stateless ops at a CLASH_* trigger', () => {
    for (const c of compiled) {
      for (const e of c.effects) {
        if (e.trigger.startsWith('CLASH_')) {
          for (const op of e.ops) expect(STATELESS_OPS.has(op.op)).toBe(true);
        }
      }
    }
  });
});

describe('region derivation', () => {
  it('makes an ordinary attack a step-in melee', () => {
    expect(move('tackle').effects[0]!.region).toBe('MELEE');
    expect(opsOf(move('tackle'))).toContain('CLASH');
  });

  it('makes a spread move hit the neighbours and wound rather than knock out', () => {
    // Earthquake hits all adjacent; per the Softening rule a ranged/area hit STRIKEs, never CLASHes.
    const eq = move('earthquake');
    expect(eq.effects[0]!.region).toBe('RING1_ALL');
    expect(opsOf(eq)).toContain('STRIKE');
    expect(opsOf(eq)).not.toContain('CLASH');
  });

  it('routes a self-targeting move to SELF', () => {
    expect(move('swordsdance').effects[0]!.region).toBe('SELF');
  });

  it('routes a hazard to the enemy zone with the right layer count', () => {
    const spikes = move('spikes');
    expect(spikes.effects[0]!.region).toBe('FOE_ZONE');
    const mark = spikes.effects[0]!.ops.find((o): o is Extract<Op, { op: 'MARK' }> => o.op === 'MARK');
    expect(mark?.mark).toBe('spikes');
    expect(mark?.layers).toBe(3);
    expect((move('stealthrock').effects[0]!.ops[0] as Extract<Op, { op: 'MARK' }>).layers).toBe(1);
  });
});

// The heart of the compiler's argument: fifteen mechanics this different are all lists of the same ops.
describe('the SPEC §13.7 worked examples, traced end to end', () => {
  it('Trick Room — a 5-turn board mark', () => {
    const tr = move('trickroom');
    expect(marksOf(tr)).toContain('trickroom');
    expect(tr.effects.some((e) => e.region === 'BOARD')).toBe(true);
  });

  it('Baton Pass — relocate and leave a legacy for the next friendly piece', () => {
    expect(opsOf(move('batonpass'))).toContain('RELOCATE');
    expect(marksOf(move('batonpass'))).toContain('legacy');
    expect(move('batonpass').provenance).toBe('curated');
  });

  it('Metronome — an INVOKE with depth 1, so it cannot call itself', () => {
    const inv = move('metronome').effects.flatMap((e) => e.ops).find((o) => o.op === 'INVOKE');
    expect(inv).toBeDefined();
    expect((inv as Extract<Op, { op: 'INVOKE' }>).depth).toBe(1);
  });

  it('Transform — become the target, keep your own shell', () => {
    expect(opsOf(move('transform'))).toContain('BECOME');
  });

  it('Perish Song — a board-wide countdown mark', () => {
    const mark = move('perishsong').effects[0]!.ops.find((o): o is Extract<Op, { op: 'MARK' }> => o.op === 'MARK');
    expect(mark?.mark).toBe('perish');
    expect(mark?.data).toBe(3);
  });

  it('Belly Drum — halve HP, max Attack, read from the source not the fields', () => {
    const ops = move('bellydrum').effects[0]!.ops;
    expect(ops.some((o) => o.op === 'STRIKE')).toBe(true);
    const boost = ops.find((o): o is Extract<Op, { op: 'BOOST' }> => o.op === 'BOOST');
    expect(boost?.d.atk).toBe(12);
    expect(move('bellydrum').provenance).toBe('curated');
  });

  it('Explosion — a real Clash on every neighbour (self-destruct is the Softening exception), then remove yourself', () => {
    const ex = move('explosion');
    expect(ex.effects[0]!.region).toBe('RING1_ALL');
    // It must CLASH, not merely STRIKE: self-destruct is the one thing that may kill at range, so
    // Explosion keeps its lethality.
    expect(opsOf(ex)).toContain('CLASH');
    expect(opsOf(ex)).toContain('REMOVE');
  });

  it('Sketch — learns a move rather than wiping the held item', () => {
    const equip = move('sketch').effects[0]!.ops.find((o): o is Extract<Op, { op: 'EQUIP' }> => o.op === 'EQUIP');
    expect(equip?.learn).toBe('last-move');
    expect(equip?.item).toBeUndefined();
  });

  it('Transform — copies the target\'s forme, so "moves" in its summary is real', () => {
    const become = move('transform').effects[0]!.ops.find((o): o is Extract<Op, { op: 'BECOME' }> => o.op === 'BECOME');
    expect(become?.type).toBe('target');
    expect(become?.forme).toBe('target');
  });

  it('Substitute — spend HP to place a decoy mark, not a second piece', () => {
    const ops = move('substitute').effects[0]!.ops;
    expect(ops.some((o) => o.op === 'STRIKE')).toBe(true);
    expect(ops.some((o) => o.op === 'MARK')).toBe(true);
    // Crucially never SUMMON — the termination proof forbids adding a piece.
    expect(opsOf(move('substitute'))).not.toContain('SUMMON');
  });

  it('Rest — sleep and full heal, recovered from a stripped status field', () => {
    const ops = move('rest').effects[0]!.ops;
    expect(ops.some((o) => o.op === 'MEND')).toBe(true);
    expect(marksOf(move('rest'))).toContain('asleep');
  });
});

describe('field-level guards', () => {
  it('gives a status move a status mark', () => {
    // Thunder Wave paralyzes.
    expect(marksOf(move('thunderwave'))).toContain('paralyzed');
    expect(marksOf(move('willowisp'))).toContain('burned');
    expect(marksOf(move('toxic'))).toContain('badly-poisoned');
  });

  it('turns a damaging move\'s secondary into a chance-gated rider', () => {
    // Thunderbolt: 10% paralysis, read from `secondaries` (never doubled).
    const tbolt = move('thunderbolt');
    const rider = tbolt.effects.find((e) => e.guards?.some((g) => g.cond.startsWith('chance:')));
    expect(rider).toBeDefined();
    expect(rider!.ops.some((o) => o.op === 'MARK')).toBe(true);
  });

  it('reads drain, recoil and heal as literal HP fractions', () => {
    // Giga Drain heals; Brave Bird recoils.
    expect(opsOf(move('gigadrain'))).toContain('MEND');
    expect(opsOf(move('bravebird'))).toContain('STRIKE');
  });

  it('is a pure function — compiling twice gives the same result', () => {
    const m = dex.getMove('closecombat')!;
    expect(compileMove(m)).toEqual(compileMove(m));
  });
});
