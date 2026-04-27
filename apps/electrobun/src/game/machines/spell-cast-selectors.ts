import { useSyncExternalStore } from "react";

import { spellCastActor } from "@/game/machines/spell-cast.machine";
import type { SpellEntry } from "@/game/stores/spells-store";

export interface SpellCastView {
  selectedSpellId: number | null;
  selectedSpell: SpellEntry | null;
  isTargeting: boolean;
  isPending: boolean;
  isAnimating: boolean;
  isRejected: boolean;
  rejectionReason: string | null;
  hoveredCellId: number | null;
  targetCellId: number | null;
  targetingCells: number[];
  previewCells: number[];
}

let cachedSnapshot: SpellCastView = read();

function read(): SpellCastView {
  const snap = spellCastActor.getSnapshot();
  return {
    selectedSpellId: snap.context.spell?.spellId ?? null,
    selectedSpell: snap.context.spell,
    isTargeting: snap.matches("targeting"),
    isPending: snap.matches("pending"),
    isAnimating: snap.matches("animating") || snap.matches("resolving"),
    isRejected: snap.matches("rejected"),
    rejectionReason: snap.context.rejectionReason,
    hoveredCellId: snap.context.hoveredCellId,
    targetCellId: snap.context.targetCellId,
    targetingCells: snap.context.targetingCells,
    previewCells: snap.context.previewCells,
  };
}

function shallowEqual(a: SpellCastView, b: SpellCastView): boolean {
  return (
    a.selectedSpellId === b.selectedSpellId &&
    a.selectedSpell === b.selectedSpell &&
    a.isTargeting === b.isTargeting &&
    a.isPending === b.isPending &&
    a.isAnimating === b.isAnimating &&
    a.isRejected === b.isRejected &&
    a.rejectionReason === b.rejectionReason &&
    a.hoveredCellId === b.hoveredCellId &&
    a.targetCellId === b.targetCellId &&
    a.targetingCells === b.targetingCells &&
    a.previewCells === b.previewCells
  );
}

function subscribe(listener: () => void): () => void {
  const sub = spellCastActor.subscribe(() => {
    const next = read();
    if (!shallowEqual(cachedSnapshot, next)) {
      cachedSnapshot = next;
      listener();
    }
  });
  return () => sub.unsubscribe();
}

function getSnapshot(): SpellCastView {
  return cachedSnapshot;
}

/**
 * React binding to the spell-cast machine. Returns a stable view
 * object that only re-renders subscribers when a field actually
 * changes — spellCastActor emits on every transition, including
 * no-op events we don't care about.
 */
export function useSpellCast(): SpellCastView {
  return useSyncExternalStore(subscribe, getSnapshot);
}
