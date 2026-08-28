import { describe, expect, it } from 'vitest';

import { Dex } from '../data/dex.ts';
import type { CompiledEntry } from './isa.ts';
import { compileAllAbilities } from './compileAbilities.ts';
import { compileAllItems } from './compileItems.ts';

const dex = await Dex.load();
const abilities = compileAllAbilities(dex.abilities);
const items = compileAllItems(dex.items);
const abilityById = new Map(abilities.map((c) => [c.id, c]));
const itemById = new Map(items.map((c) => [c.id, c]));

function tally(entries: CompiledEntry[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of entries) out[e.provenance] = (out[e.provenance] ?? 0) + 1;
  return out;
}

describe('abilities — total coverage', () => {
  it('compiles all 311 abilities, each with a summary', () => {
    expect(abilities).toHaveLength(dex.abilities.length);
    for (const a of abilities) expect(a.summary.length).toBeGreaterThan(0);
  });

  it('never falls through to a generic fallback — every ability is curated, classified, or inert', () => {
    const t = tally(abilities);
    // `fallback` means a classification failure, and the branch structure makes it unreachable: an
    // ability with any handler is at least classified `handlers`, and one with none is `inert`.
    expect(t['fallback'] ?? 0).toBe(0);
    expect((t['curated'] ?? 0)).toBeGreaterThan(10);
    expect((t['handlers'] ?? 0)).toBeGreaterThan(100);
  });

  it('reads the iconic abilities faithfully', () => {
    // Levitate is a Ground immunity — a VETO guarded by the type.
    const lev = abilityById.get('levitate')!;
    expect(lev.provenance).toBe('curated');
    expect(lev.effects[0]!.ops[0]!.op).toBe('VETO');
    expect(lev.effects[0]!.guards?.[0]?.cond).toContain('Ground');

    // Wonder Guard vetoes anything not super-effective.
    const wg = abilityById.get('wonderguard')!;
    expect(wg.effects[0]!.guards?.[0]?.cond).toBe('not-super-effective');

    // Intimidate lowers adjacent enemies' Attack on arrival.
    const intim = abilityById.get('intimidate')!;
    expect(intim.effects[0]!.trigger).toBe('ON_ENTER');
    expect(intim.effects[0]!.region).toBe('RING1_FOES');

    // Rough Skin punishes a contact attacker.
    const rs = abilityById.get('roughskin')!;
    expect(rs.effects[0]!.trigger).toBe('ON_DAMAGED');
    expect(rs.effects[0]!.ops[0]!.op).toBe('STRIKE');

    // Sturdy is a survive-once clamp.
    const sturdy = abilityById.get('sturdy')!;
    expect(sturdy.effects[0]!.ops[0]).toMatchObject({ op: 'CLAMP', to: 1, when: 'pristine' });
  });

  it('classifies a trapping ability as a bounded bind that never holds a king', () => {
    const st = abilityById.get('shadowtag')!;
    expect(st.effects[0]!.region).toBe('KING_RING');
    expect(st.effects[0]!.ops[0]!.op).toBe('VETO');
    expect(st.effects[0]!.guards?.some((g) => g.cond.includes('not-class:king'))).toBe(true);
  });

  it('never leaves a king-trapping ability able to reach the whole board', () => {
    // The compiler has no global region, so a trap is structurally bounded to KING_RING.
    for (const a of abilities) {
      for (const e of a.effects) {
        if (e.ops.some((o) => o.op === 'VETO' && o.scope === 'bind')) {
          expect(e.region).toBe('KING_RING');
        }
      }
    }
  });
});

describe('items — total coverage', () => {
  it('compiles all 536 items, each with a summary', () => {
    expect(items).toHaveLength(dex.items.length);
    for (const i of items) expect(i.summary.length).toBeGreaterThan(0);
  });

  it('marks meaningless items inert rather than inventing effects for them', () => {
    // Poké Balls have no board meaning; that is coverage, not a gap.
    const t = tally(items);
    expect((t['inert'] ?? 0)).toBeGreaterThan(100);
    const ball = itemById.get('pokeball');
    if (ball) expect(ball.provenance).toBe('inert');
  });

  it('reads the iconic items faithfully', () => {
    expect(itemById.get('leftovers')!.effects[0]!.ops[0]).toMatchObject({ op: 'MEND' });
    expect(itemById.get('leftovers')!.effects[0]!.trigger).toBe('ON_CHECKUP');

    const lo = itemById.get('lifeorb')!;
    expect(lo.effects.some((e) => e.ops.some((o) => o.op === 'MODIFY'))).toBe(true);
    expect(lo.effects.some((e) => e.ops.some((o) => o.op === 'STRIKE'))).toBe(true);

    const sash = itemById.get('focussash')!;
    expect(sash.effects[0]!.ops.some((o) => o.op === 'CLAMP')).toBe(true);

    const band = itemById.get('choiceband')!;
    expect(band.effects.some((e) => e.ops.some((o) => o.op === 'TEMPO' && o.kind === 'lock-slot'))).toBe(true);
  });

  it('never emits a piece-creating op anywhere in the content', () => {
    for (const entry of [...abilities, ...items]) {
      for (const e of entry.effects) {
        for (const o of e.ops) expect(o.op).not.toBe('SUMMON');
      }
    }
  });
});
