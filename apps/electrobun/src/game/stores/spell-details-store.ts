import type { SpellDetails } from "@/game/network/protocol";

import { ExternalStore } from "./game-store";

/** One effect line of a spell level, as it arrives on the Sd frame. */
export interface SpellDetailEffect {
  effectId: number;
  min: number;
  max: number;
  special: number;
  duration: number;
  probability: number;
  areaKind: number;
  areaSize: number;
  param: string;
}

export interface SpellDetailLevel {
  level: number;
  apCost: number;
  rangeMin: number;
  rangeMax: number;
  criticalRate: number;
  failureRate: number;
  lineOfSight: boolean;
  emptyCell: boolean;
  modifiableRange: boolean;
  lineOnly: boolean;
  castPerTurn: number;
  castPerTarget: number;
  cooldown: number;
  minPlayerLevel: number;
  critFailureEndsTurn: boolean;
  effects: SpellDetailEffect[];
  criticalEffects: SpellDetailEffect[];
}

export interface SpellDetailEntry {
  spellId: number;
  name: string;
  description: string;
  /** Level the player owns, 0 when the spell is only being previewed. */
  playerLevel: number;
  levels: SpellDetailLevel[];
}

export interface SpellDetailsState {
  /**
   * Per-spell cache. The panel only ever displays one spell, but keeping
   * previously-opened ones means clicking back and forth in the list does
   * not re-round-trip — a spell's level table only changes when the
   * player upgrades it, which invalidates exactly that one entry.
   */
  byId: Map<number, SpellDetailEntry>;
  /** Spell ids with a request in flight, so the panel can show a wait state. */
  pending: Set<number>;
}

const initial: SpellDetailsState = {
  byId: new Map(),
  pending: new Set(),
};

export const spellDetailsStore = new ExternalStore<SpellDetailsState>(initial);

export function markSpellDetailsPending(spellId: number): void {
  const state = spellDetailsStore.getSnapshot();
  if (state.pending.has(spellId)) {
    return;
  }
  const pending = new Set(state.pending);
  pending.add(spellId);
  spellDetailsStore.replaceState({ byId: state.byId, pending });
}

export function applySpellDetails(details: SpellDetails): void {
  const state = spellDetailsStore.getSnapshot();
  const byId = new Map(state.byId);
  byId.set(details.spellId, {
    spellId: details.spellId,
    name: details.name,
    description: details.description,
    playerLevel: details.playerLevel,
    levels: details.levels.map((l) => ({
      level: l.level,
      apCost: l.apCost,
      rangeMin: l.rangeMin,
      rangeMax: l.rangeMax,
      criticalRate: l.criticalRate,
      failureRate: l.failureRate,
      lineOfSight: l.lineOfSight,
      emptyCell: l.emptyCell,
      modifiableRange: l.modifiableRange,
      lineOnly: l.lineOnly,
      castPerTurn: l.castPerTurn,
      castPerTarget: l.castPerTarget,
      cooldown: l.cooldown,
      minPlayerLevel: l.minPlayerLevel,
      critFailureEndsTurn: l.critFailureEndsTurn,
      effects: l.effects.map(toEffect),
      criticalEffects: l.criticalEffects.map(toEffect),
    })),
  });
  const pending = new Set(state.pending);
  pending.delete(details.spellId);
  spellDetailsStore.replaceState({ byId, pending });
}

/**
 * Records a successful upgrade without a second round-trip: only
 * `playerLevel` moves, the level table itself is unchanged.
 */
export function applySpellDetailsLevel(spellId: number, level: number): void {
  const state = spellDetailsStore.getSnapshot();
  const existing = state.byId.get(spellId);
  if (!existing || existing.playerLevel === level) {
    return;
  }
  const byId = new Map(state.byId);
  byId.set(spellId, { ...existing, playerLevel: level });
  spellDetailsStore.replaceState({ byId, pending: state.pending });
}

/** Drops a spell that failed to resolve so the panel can retry. */
export function clearSpellDetailsPending(spellId: number): void {
  const state = spellDetailsStore.getSnapshot();
  if (!state.pending.has(spellId)) {
    return;
  }
  const pending = new Set(state.pending);
  pending.delete(spellId);
  spellDetailsStore.replaceState({ byId: state.byId, pending });
}

function toEffect(e: SpellDetails["levels"][number]["effects"][number]) {
  return {
    effectId: e.effectId,
    min: e.min,
    max: e.max,
    special: e.special,
    duration: e.duration,
    probability: e.probability,
    areaKind: e.areaKind,
    areaSize: e.areaSize,
    param: e.param,
  };
}
