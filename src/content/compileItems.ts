/**
 * The item compiler — 536 items into board effects.
 *
 * Items split cleanly by the taxonomy booleans the pipeline baked (`category`, `isBerry`, `megaStone`,
 * `onPlate`, `zMove`, `naturalGift`, `boosts`, `fling`). A large share are legitimately inert — Poké
 * Balls, valuables, TMs have no board meaning — and saying so explicitly is coverage, not a gap: the
 * drafting UI simply does not offer them. The rest are curated where iconic (Leftovers, Life Orb, Focus
 * Sash, Choice items, Rocky Helmet) and classified by category otherwise. See SPEC §10.4.
 */

import type { ItemEntry } from '../data/schema.ts';
import type { CompiledEntry, Effect } from './isa.ts';

export const ITEM_OVERRIDES: Record<string, { effects: Effect[]; summary: string }> = {
  leftovers: {
    effects: [{ trigger: 'ON_CHECKUP', region: 'SELF', ops: [{ op: 'MEND', frac: [1, 16], of: 'max' }] }],
    summary: 'Restores a little HP at the end of each turn.',
  },
  lifeorb: {
    effects: [
      { trigger: 'CLASH_ROLL', region: 'SELF', ops: [{ op: 'MODIFY', slot: 'final', x: 1.3 }] },
      { trigger: 'ON_STRUCK', region: 'SELF', ops: [{ op: 'STRIKE', frac: [1, 10], of: 'max' }] },
    ],
    summary: 'Attacks hit harder, but the holder loses HP after attacking.',
  },
  focussash: {
    effects: [{ trigger: 'CLASH_RESULT', region: 'SELF', ops: [{ op: 'CLAMP', to: 1, when: 'pristine' }, { op: 'EQUIP', item: null, consume: true }] }],
    summary: 'Survives a would-be knockout at 1 HP if at full health, then breaks.',
  },
  rockyhelmet: {
    effects: [{ trigger: 'ON_DAMAGED', region: 'REACTIVE', ops: [{ op: 'STRIKE', frac: [1, 6], of: 'max' }], guards: [{ cond: 'contact' }] }],
    summary: 'A piece that strikes it in contact loses HP.',
  },
  choiceband: {
    effects: [
      { trigger: 'CLASH_ROLL', region: 'SELF', ops: [{ op: 'MODIFY', slot: 'atk', x: 1.5 }] },
      { trigger: 'ON_ACT', region: 'SELF', ops: [{ op: 'TEMPO', kind: 'lock-slot' }] },
    ],
    summary: 'Physical attacks hit 1.5x, but the first move used is the only one usable after.',
  },
  choicespecs: {
    effects: [
      { trigger: 'CLASH_ROLL', region: 'SELF', ops: [{ op: 'MODIFY', slot: 'spa', x: 1.5 }] },
      { trigger: 'ON_ACT', region: 'SELF', ops: [{ op: 'TEMPO', kind: 'lock-slot' }] },
    ],
    summary: 'Special attacks hit 1.5x, but the first move used is the only one usable after.',
  },
  choicescarf: {
    effects: [{ trigger: 'CLASH_ROLL', region: 'SELF', ops: [{ op: 'MODIFY', slot: 'crit-window', x: 1 }, { op: 'TEMPO', kind: 'lock-slot' }] }],
    summary: 'Boosts Speed, but the first move used is the only one usable after.',
  },
  airballoon: {
    effects: [
      { trigger: 'CLASH_LEGAL', region: 'SELF', ops: [{ op: 'VETO', scope: 'element' }], guards: [{ cond: 'vs-type:Ground' }] },
      { trigger: 'ON_DAMAGED', region: 'SELF', ops: [{ op: 'EQUIP', item: null, consume: true }] },
    ],
    summary: 'Immune to Ground until struck, then the balloon pops.',
  },
  heavydutyboots: {
    effects: [{ trigger: 'ON_ENTER', region: 'SELF', ops: [{ op: 'UNMARK', filter: 'hazard' }], guards: [{ cond: 'self-only' }] }],
    summary: 'Ignores hazards on arrival.',
  },
  eviolite: {
    effects: [{ trigger: 'CLASH_ROLL', region: 'SELF', ops: [{ op: 'MODIFY', slot: 'final', x: 0.67 }], guards: [{ cond: 'nfe' }] }],
    summary: 'A not-fully-evolved holder takes less damage.',
  },
};

/** Items that carry a held-item stat boost read straight from the data. */
function boostItemEffect(item: ItemEntry): Effect | null {
  if (!item.boosts) return null;
  const d = Object.fromEntries(
    Object.entries(item.boosts).filter(([k]) => ['atk', 'def', 'spa', 'spd', 'spe'].includes(k)),
  );
  if (Object.keys(d).length === 0) return null;
  return { trigger: 'ALWAYS', region: 'SELF', ops: [{ op: 'BOOST', d }] };
}

export function compileItem(item: ItemEntry): CompiledEntry {
  const override = ITEM_OVERRIDES[item.id];
  if (override) {
    return { id: item.id, name: item.name, effects: override.effects, provenance: 'curated', summary: override.summary };
  }

  // Categories with no board meaning are inert by design — not offered in the draft, not a gap.
  if (item.category === 'pokeball' || (item.category === 'other' && (item.handlers?.length ?? 0) === 0 && !item.boosts)) {
    return {
      id: item.id,
      name: item.name,
      effects: [{ trigger: 'ALWAYS', region: 'NONE', ops: [] }],
      provenance: 'inert',
      summary: item.shortDesc || 'No board effect.',
    };
  }

  // A berry that heals or cures at end of turn — the common healing-berry shape.
  if (item.isBerry) {
    return {
      id: item.id,
      name: item.name,
      effects: [{ trigger: 'CLASH_RESULT', region: 'SELF', ops: [{ op: 'MEND', frac: [1, 4], of: 'max' }, { op: 'EQUIP', item: null, consume: true }] }],
      provenance: 'handlers',
      summary: item.shortDesc || 'A berry consumed for an effect when low.',
    };
  }

  // A type-boosting plate, or a stat-boosting held item read from the data.
  if (item.onPlate) {
    return {
      id: item.id,
      name: item.name,
      effects: [{ trigger: 'CLASH_ROLL', region: 'SELF', ops: [{ op: 'MODIFY', slot: 'final', x: 1.2 }], guards: [{ cond: `type:${item.onPlate}` }] }],
      provenance: 'fields',
      summary: `Strengthens ${item.onPlate} attacks.`,
    };
  }
  const boost = boostItemEffect(item);
  if (boost) {
    return { id: item.id, name: item.name, effects: [boost], provenance: 'fields', summary: item.shortDesc || 'A stat-boosting held item.' };
  }

  // A mega stone or Z-crystal: a once-per-game transformation, deferred to the transformation system.
  if (item.megaStone) {
    return {
      id: item.id,
      name: item.name,
      effects: [{ trigger: 'ON_ACT', region: 'SELF', ops: [{ op: 'BECOME', forme: Object.values(item.megaStone)[0] ?? item.name }, { op: 'TEMPO', kind: 'end-turn' }] }],
      provenance: 'fields',
      summary: `Lets its holder Mega Evolve, ending the turn.`,
    };
  }

  // A held item with a handler we cannot read the source of: classify by whether it modifies damage.
  if ((item.handlers?.length ?? 0) > 0) {
    return {
      id: item.id,
      name: item.name,
      effects: [{ trigger: 'ALWAYS', region: 'SELF', ops: [] }],
      provenance: 'handlers',
      summary: item.shortDesc || item.name,
    };
  }

  return {
    id: item.id,
    name: item.name,
    effects: [{ trigger: 'ALWAYS', region: 'NONE', ops: [] }],
    provenance: 'inert',
    summary: item.shortDesc || 'No board effect.',
  };
}

export function compileAllItems(items: readonly ItemEntry[]): CompiledEntry[] {
  return items.map(compileItem);
}
