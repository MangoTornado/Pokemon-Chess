/**
 * The ability compiler — 311 abilities into board effects.
 *
 * Abilities are harder than moves: `@pkmn/dex` strips their behaviour callbacks and, unlike moves, they
 * carry almost no declarative fields. What survives is the *handler fingerprint* — the set of `on*`
 * hooks an ability defines — which is a strong structural classifier (`onDamagingHit` ⇒ punishes the
 * attacker, `onStart` ⇒ fires on arrival, `onFoeTrapPokemon` ⇒ restricts enemy movement), plus prose.
 *
 * So this compiler works the other way round from moves: a curated layer supplies the iconic abilities
 * faithfully, the fingerprint classifies the rest into a board-effect archetype, and a total fallback
 * catches the handful with neither. See SPEC §10 and `docs/design/recon-abilities-items.md`.
 */

import type { AbilityEntry } from '../data/schema.ts';
import type { CompiledEntry, Effect, Provenance } from './isa.ts';

// ---------------------------------------------------------------------------
// Curated iconic abilities — the ones whose exact behaviour matters and which the fingerprint alone
// cannot pin. Each is a faithful reading of what the ability does in the games.
// ---------------------------------------------------------------------------

export const ABILITY_OVERRIDES: Record<string, { effects: Effect[]; summary: string }> = {
  // Type-immunity abilities: a VETO that makes a capture of this piece illegal, guarded by the type.
  // Levitate has no handler in @pkmn/sim either (the engine special-cases it), so it must be curated.
  levitate: {
    effects: [{ trigger: 'CLASH_LEGAL', region: 'SELF', ops: [{ op: 'VETO', scope: 'type' }], guards: [{ cond: 'vs-type:Ground' }] }],
    summary: 'Cannot be captured by Ground.',
  },
  flashfire: {
    effects: [{ trigger: 'CLASH_LEGAL', region: 'SELF', ops: [{ op: 'VETO', scope: 'type' }], guards: [{ cond: 'vs-type:Fire' }] }],
    summary: 'Cannot be captured by Fire.',
  },
  waterabsorb: {
    effects: [{ trigger: 'CLASH_LEGAL', region: 'SELF', ops: [{ op: 'VETO', scope: 'type' }], guards: [{ cond: 'vs-type:Water' }] }],
    summary: 'Cannot be captured by Water.',
  },
  voltabsorb: {
    effects: [{ trigger: 'CLASH_LEGAL', region: 'SELF', ops: [{ op: 'VETO', scope: 'type' }], guards: [{ cond: 'vs-type:Electric' }] }],
    summary: 'Cannot be captured by Electric.',
  },
  wonderguard: {
    // Only a super-effective Clash may damage it — permanent and literal, but never against a King (R6).
    effects: [{ trigger: 'CLASH_LEGAL', region: 'SELF', ops: [{ op: 'VETO', scope: 'absolute' }], guards: [{ cond: 'not-super-effective' }] }],
    summary: 'Only a super-effective attack can damage it.',
  },
  // On-arrival abilities: fire when the piece enters a square.
  intimidate: {
    effects: [{ trigger: 'ON_ENTER', region: 'RING1_FOES', ops: [{ op: 'BOOST', d: { atk: -1 } }] }],
    summary: 'On arrival, lowers the Attack of adjacent enemies.',
  },
  drizzle: {
    effects: [{ trigger: 'ON_ENTER', region: 'BOARD', ops: [{ op: 'MARK', mark: 'raindance', dur: 5 }] }],
    summary: 'On arrival, summons rain.',
  },
  drought: {
    effects: [{ trigger: 'ON_ENTER', region: 'BOARD', ops: [{ op: 'MARK', mark: 'sunnyday', dur: 5 }] }],
    summary: 'On arrival, summons harsh sunlight.',
  },
  // Contact-punish abilities: hurt whatever strikes this piece.
  roughskin: {
    effects: [{ trigger: 'ON_DAMAGED', region: 'REACTIVE', ops: [{ op: 'STRIKE', frac: [1, 8], of: 'max' }], guards: [{ cond: 'contact' }] }],
    summary: 'A piece that strikes it in contact loses HP.',
  },
  ironbarbs: {
    effects: [{ trigger: 'ON_DAMAGED', region: 'REACTIVE', ops: [{ op: 'STRIKE', frac: [1, 8], of: 'max' }], guards: [{ cond: 'contact' }] }],
    summary: 'A piece that strikes it in contact loses HP.',
  },
  static: {
    effects: [{ trigger: 'ON_DAMAGED', region: 'REACTIVE', ops: [{ op: 'MARK', mark: 'paralyzed' }], guards: [{ cond: 'contact,chance:30' }] }],
    summary: 'A piece that strikes it in contact may be paralyzed.',
  },
  flamebody: {
    effects: [{ trigger: 'ON_DAMAGED', region: 'REACTIVE', ops: [{ op: 'MARK', mark: 'burned' }], guards: [{ cond: 'contact,chance:30' }] }],
    summary: 'A piece that strikes it in contact may be burned.',
  },
  // Survive-once abilities: clamp HP to 1 when the piece was at full health.
  sturdy: {
    effects: [{ trigger: 'CLASH_RESULT', region: 'SELF', ops: [{ op: 'CLAMP', to: 1, when: 'pristine' }] }],
    summary: 'Survives a would-be knockout at 1 HP if it was at full health.',
  },
  multiscale: {
    effects: [{ trigger: 'CLASH_ROLL', region: 'SELF', ops: [{ op: 'MODIFY', slot: 'final', x: 0.5 }], guards: [{ cond: 'pristine' }] }],
    summary: 'Halves damage taken while at full health.',
  },
  // Trapping abilities: restrict adjacent enemy movement, never a King.
  arenatrap: {
    effects: [{ trigger: 'ALWAYS', region: 'KING_RING', ops: [{ op: 'VETO', scope: 'bind' }], guards: [{ cond: 'not-class:king,grounded' }] }],
    summary: 'Grounded adjacent enemies cannot move away.',
  },
  shadowtag: {
    effects: [{ trigger: 'ALWAYS', region: 'KING_RING', ops: [{ op: 'VETO', scope: 'bind' }], guards: [{ cond: 'not-class:king' }] }],
    summary: 'Adjacent enemies cannot move away.',
  },
  // Type-changing abilities: the piece's declared type becomes its move's type.
  protean: {
    effects: [{ trigger: 'ON_ACT', region: 'SELF', ops: [{ op: 'BECOME', type: 'target' }] }],
    summary: 'Becomes the type of the move it uses.',
  },
  libero: {
    effects: [{ trigger: 'ON_ACT', region: 'SELF', ops: [{ op: 'BECOME', type: 'target' }] }],
    summary: 'Becomes the type of the move it uses.',
  },
  // Offensive/defensive standing modifiers.
  hugepower: {
    effects: [{ trigger: 'CLASH_ROLL', region: 'SELF', ops: [{ op: 'MODIFY', slot: 'atk', x: 2 }] }],
    summary: 'Doubles physical attack strength.',
  },
  furcoat: {
    effects: [{ trigger: 'CLASH_ROLL', region: 'SELF', ops: [{ op: 'MODIFY', slot: 'def', x: 2 }] }],
    summary: 'Doubles physical bulk.',
  },
  // The following were caught unfaithful by the faithfulness review and are curated to match the games.
  magicguard: {
    // Immunity to all indirect damage — hazards, status ticks, recoil — not a damage reduction.
    effects: [{ trigger: 'ON_CHECKUP', region: 'SELF', ops: [{ op: 'VETO', scope: 'indirect' }] }],
    summary: 'Takes no damage from anything but a direct attack — hazards, status and recoil cannot hurt it.',
  },
  disguise: {
    // A one-shot ward: the first hit is absorbed. Files with Sturdy/Multiscale, not with status immunity.
    effects: [{ trigger: 'CLASH_RESULT', region: 'SELF', ops: [{ op: 'CLAMP', to: 1, when: 'pristine' }] }],
    summary: 'Blocks the first attack that would harm it while at full health.',
  },
  moldbreaker: {
    // Ignores the defender's abilities — it pierces wards rather than hitting harder.
    effects: [{ trigger: 'CLASH_LEGAL', region: 'SELF', ops: [{ op: 'PIERCE', scope: ['element', 'type', 'absolute'] }] }],
    summary: 'Its attacks ignore the target\'s ability, so wards like Levitate do not stop it.',
  },
  regenerator: {
    effects: [{ trigger: 'ON_EXIT', region: 'SELF', ops: [{ op: 'MEND', frac: [1, 3], of: 'max' }] }],
    summary: 'Restores a third of its HP whenever it retreats.',
  },
  speedboost: {
    effects: [{ trigger: 'ON_CHECKUP', region: 'SELF', ops: [{ op: 'BOOST', d: { spe: 1 } }] }],
    summary: 'Gains a Speed stage at the end of each turn.',
  },
  trace: {
    effects: [{ trigger: 'ON_ENTER', region: 'SELF', ops: [{ op: 'EQUIP', ability: 'copy-foe' }] }],
    summary: 'On arrival, copies an adjacent enemy\'s ability.',
  },
  download: {
    effects: [{ trigger: 'ON_ENTER', region: 'SELF', ops: [{ op: 'BOOST', d: { atk: 1, spa: 1 } }], guards: [{ cond: 'weaker-foe-defense' }] }],
    summary: 'On arrival, raises Attack or Special Attack against the enemy\'s weaker defence.',
  },
};

// ---------------------------------------------------------------------------
// Fingerprint classification — an archetype from the set of handler names
// ---------------------------------------------------------------------------

interface Archetype {
  effect: (a: AbilityEntry) => Effect;
  summary: string;
  provenance: Provenance;
}

/** Maps a handler name to a board-effect archetype, most specific first. */
function archetypeFor(handlers: readonly string[]): Archetype | null {
  const has = (name: string) => handlers.includes(name);

  if (has('onFoeTrapPokemon') || has('onFoeMaybeTrapPokemon')) {
    return {
      effect: () => ({ trigger: 'ALWAYS', region: 'KING_RING', ops: [{ op: 'VETO', scope: 'bind' }], guards: [{ cond: 'not-class:king' }] }),
      summary: 'Restricts the movement of adjacent enemies.',
      provenance: 'handlers',
    };
  }
  if (has('onDamagingHit')) {
    return {
      effect: () => ({ trigger: 'ON_DAMAGED', region: 'REACTIVE', ops: [{ op: 'STRIKE', frac: [1, 8], of: 'max' }], guards: [{ cond: 'contact' }] }),
      summary: 'Reacts when struck in contact.',
      provenance: 'handlers',
    };
  }
  if (has('onModifyType')) {
    return {
      effect: () => ({ trigger: 'ON_ACT', region: 'SELF', ops: [{ op: 'BECOME', type: 'target' }] }),
      summary: 'Alters the type of its attacks.',
      provenance: 'handlers',
    };
  }
  if (has('onModifyAtk') || has('onModifySpA') || has('onBasePower') || has('onModifyMove')) {
    return {
      effect: () => ({ trigger: 'CLASH_ROLL', region: 'SELF', ops: [{ op: 'MODIFY', slot: 'final', x: 1.3 }] }),
      summary: 'Strengthens its attacks in some condition.',
      provenance: 'handlers',
    };
  }
  if (has('onSourceModifyDamage') || has('onModifyDef') || has('onModifySpD')) {
    return {
      effect: () => ({ trigger: 'CLASH_ROLL', region: 'SELF', ops: [{ op: 'MODIFY', slot: 'final', x: 0.75 }] }),
      summary: 'Reduces damage it takes in some condition.',
      provenance: 'handlers',
    };
  }
  if (has('onTryHit') || has('onTryBoost')) {
    return {
      effect: () => ({ trigger: 'CLASH_LEGAL', region: 'SELF', ops: [{ op: 'VETO', scope: 'element' }], guards: [{ cond: 'conditional' }] }),
      summary: 'Can negate certain attacks or effects against it.',
      provenance: 'handlers',
    };
  }
  if (has('onSetStatus') || has('onImmunity') || has('onTryAddVolatile') || has('onUpdate') || has('onAllySetStatus')) {
    return {
      effect: () => ({ trigger: 'ON_DAMAGED', region: 'SELF', ops: [{ op: 'VETO', scope: 'rider' }], guards: [{ cond: 'status-immunity' }] }),
      summary: 'Prevents or removes certain status conditions.',
      provenance: 'handlers',
    };
  }
  if (has('onDamage') || has('onModifyDamage') || has('onSourceModifyAtk') || has('onSourceModifySpA')) {
    return {
      effect: () => ({ trigger: 'CLASH_ROLL', region: 'SELF', ops: [{ op: 'MODIFY', slot: 'final', x: 0.75 }] }),
      summary: 'Reduces damage in some condition.',
      provenance: 'handlers',
    };
  }
  if (has('onModifyAccuracy') || has('onModifyCritRatio') || has('onModifyPriority')) {
    return {
      effect: () => ({ trigger: 'CLASH_ROLL', region: 'SELF', ops: [{ op: 'MODIFY', slot: 'crit-window', x: 1 }] }),
      summary: 'Alters accuracy, criticals or initiative.',
      provenance: 'handlers',
    };
  }
  if (has('onSourceAfterFaint') || has('onFoeTryMove') || has('onAllyBasePower') || has('onAfterMoveSecondary')) {
    return {
      effect: () => ({ trigger: 'ON_KO', region: 'SELF', ops: [{ op: 'REVEAL', what: 'threats' }] }),
      summary: 'Reacts to nearby events.',
      provenance: 'handlers',
    };
  }
  if (has('onModifySpe')) {
    return {
      effect: () => ({ trigger: 'CLASH_ROLL', region: 'SELF', ops: [{ op: 'MODIFY', slot: 'crit-window', x: 1 }] }),
      summary: 'Changes its Speed in some condition.',
      provenance: 'handlers',
    };
  }
  if (has('onStart') || has('onSwitchIn')) {
    return {
      effect: () => ({ trigger: 'ON_ENTER', region: 'SELF', ops: [{ op: 'REVEAL', what: 'threats' }] }),
      summary: 'Fires an effect on arrival.',
      provenance: 'handlers',
    };
  }
  if (has('onResidual')) {
    // An end-of-turn ability might heal, damage, boost or cure — the fingerprint cannot tell which, so
    // the effect stays a neutral end-of-turn hook and the summary does not claim a specific action
    // (an earlier version assumed healing, which mis-described stat-boosters like Speed Boost).
    return {
      effect: () => ({ trigger: 'ON_CHECKUP', region: 'SELF', ops: [] }),
      summary: 'Has an effect at the end of each turn.',
      provenance: 'handlers',
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The compiler
// ---------------------------------------------------------------------------

export function compileAbility(ability: AbilityEntry): CompiledEntry {
  const override = ABILITY_OVERRIDES[ability.id];
  if (override) {
    return { id: ability.id, name: ability.name, effects: override.effects, provenance: 'curated', summary: override.summary };
  }

  const handlers = ability.handlers ?? [];
  const archetype = archetypeFor(handlers);
  if (archetype) {
    return {
      id: ability.id,
      name: ability.name,
      effects: [archetype.effect(ability)],
      provenance: archetype.provenance,
      summary: archetype.summary,
    };
  }

  // An ability with a handler we could not slot into a specific archetype still *does* something — it is
  // a standing conditional modifier — so it is classified `handlers` (approximate, flagged for a future
  // curated pass) rather than `fallback`. Its own short description keeps the UI truthful. `fallback` is
  // reserved for a genuine classification failure, which this branch structure makes unreachable.
  if (handlers.length > 0) {
    return {
      id: ability.id,
      name: ability.name,
      effects: [{ trigger: 'ALWAYS', region: 'SELF', ops: [] }],
      provenance: 'handlers',
      summary: ability.shortDesc || ability.name,
    };
  }

  // No handler at all — genuinely a standing property the engine special-cases or one with no board
  // meaning (No Ability, Ball Fetch). Deliberately inert.
  return {
    id: ability.id,
    name: ability.name,
    effects: [{ trigger: 'ALWAYS', region: 'NONE', ops: [] }],
    provenance: 'inert',
    summary: ability.shortDesc || ability.name,
  };
}

export function compileAllAbilities(abilities: readonly AbilityEntry[]): CompiledEntry[] {
  return abilities.map(compileAbility);
}
