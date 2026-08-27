import type { AreaKind, SpellData } from "@/game/network/protocol";

import { ExternalStore } from "./game-store";

/**
 * Client-side spell metadata mirroring the extended SpellList frame
 * shipped by gameserver-ts on world entry. The server hydrates this
 * from the spell_levels row so the client can validate + preview casts
 * locally without a round-trip.
 */
export interface SpellEntry {
  spellId: number;
  level: number;
  position: number;
  apCost: number;
  rangeMin: number;
  rangeMax: number;
  // Targeting flags — used by the cast machine to gate the UI.
  lineOfSight: boolean;
  modifiableRange: boolean;
  emptyCell: boolean;
  lineOnly: boolean;
  castPerTurn: number;
  castPerTarget: number;
  cooldown: number;
  criticalRate: number;
  failureRate: number;
  // Primary-effect area shape — used for AoE preview on hover.
  areaKind: AreaKind;
  areaSize: number;
  targetMask: number;
  /**
   * True when the primary effect is a trap / glyph / summon.
   * The areaKind/areaSize describe the spawned entity's trigger zone,
   * not the cast-time AOE — preview should show only the placement cell.
   */
  singleTargetSpawn: boolean;
  // Localized display data resolved server-side from `@dofus/dofus-lang`
  // against the currently-selected locale (see gameserver
  // spells.service.ts::buildSpellList). The HUD renders these directly so
  // it never needs to load a lang bundle in-browser.
  name: string;
  description: string;
  // Runtime state — not on the SpellList wire payload; updated by
  // spellCooldown frames and decremented on TURN_START for the local
  // player (wired in game-client). 0 = spell is ready.
  cooldownRemaining: number;
}

export interface SpellsState {
  spells: SpellEntry[];
  byId: Map<number, SpellEntry>;
}

const initial: SpellsState = {
  spells: [],
  byId: new Map(),
};

export const spellsStore = new ExternalStore<SpellsState>(initial);

export function applySpellList(list: readonly SpellData[]): void {
  const prev = spellsStore.getSnapshot().byId;
  const spells: SpellEntry[] = list.map((s) => {
    // Keep cooldownRemaining across a fresh SpellList — it's a
    // runtime field (not on the wire), and dropping it here would
    // wipe mid-fight cooldowns if the server ever re-emits SL.
    const existingCooldown = prev.get(s.spellId)?.cooldownRemaining ?? 0;
    return {
      spellId: s.spellId,
      level: s.level,
      position: s.position,
      apCost: s.apCost,
      rangeMin: s.rangeMin,
      rangeMax: s.rangeMax,
      lineOfSight: s.lineOfSight,
      modifiableRange: s.modifiableRange,
      emptyCell: s.emptyCell,
      lineOnly: s.lineOnly,
      castPerTurn: s.castPerTurn,
      castPerTarget: s.castPerTarget,
      cooldown: s.cooldown,
      criticalRate: s.criticalRate,
      failureRate: s.failureRate,
      areaKind: s.areaKind,
      areaSize: s.areaSize,
      targetMask: s.targetMask,
      singleTargetSpawn: s.singleTargetSpawn,
      name: s.name,
      description: s.description,
      cooldownRemaining: existingCooldown,
    };
  });
  const byId = new Map<number, SpellEntry>();
  for (const s of spells) {
    byId.set(s.spellId, s);
  }
  spellsStore.replaceState({ spells, byId });
}

/**
 * Apply a SpellCooldown frame (server sets remainingTurns to the
 * post-cast value, including 0 when the spell resets).
 */
export function applySpellCooldown(
  spellId: number,
  remainingTurns: number
): void {
  const state = spellsStore.getSnapshot();
  const existing = state.byId.get(spellId);
  if (!existing) {
    return;
  }
  const updated: SpellEntry = {
    ...existing,
    cooldownRemaining: Math.max(0, remainingTurns),
  };
  const byId = new Map(state.byId);
  byId.set(spellId, updated);
  const spells = state.spells.map((s) =>
    s.spellId === spellId ? updated : s
  );
  spellsStore.replaceState({ spells, byId });
}

/**
 * `SpellEntry.position` for a spell that is not in the hotbar — matches
 * the server's `UNSLOTTED_POSITION` and `player_spells.position`'s
 * default. Hotbar slots themselves are **1-based**.
 */
export const UNSLOTTED_POSITION = -1;

function withPositions(
  state: SpellsState,
  patch: (spell: SpellEntry) => number | undefined
): void {
  let dirty = false;
  const byId = new Map<number, SpellEntry>();
  const spells = state.spells.map((s) => {
    const position = patch(s);
    if (position === undefined || position === s.position) {
      byId.set(s.spellId, s);
      return s;
    }
    dirty = true;
    const next: SpellEntry = { ...s, position };
    byId.set(s.spellId, next);
    return next;
  });

  if (!dirty) {
    return;
  }

  spellsStore.replaceState({ spells, byId });
}

/**
 * Apply an SM frame — one spell landed in `position`.
 *
 * The server also emits an SR for every slot the move emptied, so this
 * only has to move the one spell. It still evicts any stale occupant of
 * the destination, because the two frames race through separate
 * `broadcast` calls and the bar must never show one slot twice.
 */
export function applySpellMove(spellId: number, position: number): void {
  const state = spellsStore.getSnapshot();

  withPositions(state, (s) => {
    if (s.spellId === spellId) {
      return position;
    }
    return s.position === position ? UNSLOTTED_POSITION : undefined;
  });
}

/** Apply an SR frame — whatever sat in `position` leaves the bar. */
export function applySpellRemove(position: number): void {
  const state = spellsStore.getSnapshot();

  withPositions(state, (s) =>
    s.position === position ? UNSLOTTED_POSITION : undefined
  );
}

/**
 * Decrement every spell's cooldown by one turn. Called from game-client
 * on every local-player TURN_START (no server decrement frame exists —
 * Dofus 1.29 expects the client to track cooldowns locally and the
 * server only re-pushes them on boundary events).
 */
export function tickCooldowns(): void {
  const state = spellsStore.getSnapshot();
  let dirty = false;
  const byId = new Map<number, SpellEntry>();
  const spells = state.spells.map((s) => {
    if (s.cooldownRemaining > 0) {
      dirty = true;
      const next = { ...s, cooldownRemaining: s.cooldownRemaining - 1 };
      byId.set(s.spellId, next);
      return next;
    }
    byId.set(s.spellId, s);
    return s;
  });
  if (!dirty) {
    return;
  }
  spellsStore.replaceState({ spells, byId });
}

export function spellLevel(spellId: number): number {
  return spellsStore.getSnapshot().byId.get(spellId)?.level ?? 1;
}

/** Highest level any spell can reach. */
export const MAX_SPELL_LEVEL = 6;

/**
 * Spell points it costs to raise a spell from `currentLevel` to the next
 * one — the "Coût du niveau suivant" the spell book prints on every row.
 *
 * Mirrors the server's `spell-upgrade-cost.ts`, which is the authority:
 * this copy only decides whether the row draws its `+` button.
 */
export function spellUpgradeCost(currentLevel: number): number {
  return Math.max(1, currentLevel);
}
