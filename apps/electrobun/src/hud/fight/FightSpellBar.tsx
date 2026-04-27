import { useSyncExternalStore } from "react";

import { SpellSlot } from "@/components/ui/spell-slot";
import { useSpellCast } from "@/game/machines/spell-cast-selectors";
import { spellsStore } from "@/game/stores/spells-store";
import { useFightMode } from "@/hud/fight/useFightMode";

const SLOT_COUNT = 14;

interface FightSpellBarProps {
  onSelect: (spellId: number) => void;
}

/**
 * Spell bar shown during combat. Reads spellsStore (populated from the
 * SpellList proto on world entry) and renders up to SLOT_COUNT slots
 * sorted by their position field. Selected-spell highlight comes from
 * the spellCastMachine so the HUD stays in sync with preview tints.
 */
export function FightSpellBar({ onSelect }: FightSpellBarProps) {
  const fight = useFightMode();
  const { spells } = useSyncExternalStore(
    spellsStore.subscribe,
    spellsStore.getSnapshot
  );
  const cast = useSpellCast();
  const selectedSpellId = cast.selectedSpellId;

  if (!fight.isCombat) {
    return null;
  }

  // All castable spells the player knows. Positioned ones come first
  // (sorted by slot), then unpositioned by spell id so the bar stays
  // populated even before the 0037 seed assigns positions. The
  // `spellId >= 100` guard keeps internal ids (0 = weapon attack,
  // 1..99 = server/meta spells with no atlas) out of the bar —
  // actual breed spells in Dofus 1.29 all live in the 100..3000 range.
  const slotted = spells
    .filter((s) => s.spellId >= 100)
    .sort((a, b) => {
      const aPos = a.position > 0 ? a.position : Number.POSITIVE_INFINITY;
      const bPos = b.position > 0 ? b.position : Number.POSITIVE_INFINITY;
      if (aPos !== bPos) {
        return aPos - bPos;
      }
      return a.spellId - b.spellId;
    })
    .slice(0, SLOT_COUNT);

  const ap = fight.ap;

  return (
    <div className="pointer-events-auto absolute bottom-[calc(140px*var(--resolution-factor))] left-1/2 -translate-x-1/2 flex gap-[calc(2px*var(--resolution-factor))] rounded-[calc(4px*var(--resolution-factor))] border border-[#402b15] bg-[#1a1610]/85 p-[calc(3px*var(--resolution-factor))]">
      {Array.from({ length: SLOT_COUNT }, (_, i) => {
        const spell = slotted[i];
        if (!spell) {
          return <SpellSlot key={i} state="disabled" />;
        }
        const isSelected = selectedSpellId === spell.spellId;
        const onCooldown = spell.cooldownRemaining > 0;
        const state:
          | "disabled"
          | "selected"
          | "pending"
          | "unaffordable"
          | "cooldown"
          | "ready" = !fight.isMyTurn
          ? "disabled"
          : onCooldown
            ? "cooldown"
            : isSelected && cast.isPending
              ? "pending"
              : isSelected
                ? "selected"
                : spell.apCost > ap
                  ? "unaffordable"
                  : "ready";
        return (
          <SpellSlot
            key={spell.spellId}
            state={state}
            apCost={spell.apCost}
            {...(onCooldown ? { cooldown: spell.cooldownRemaining } : {})}
            shortcut={String(i + 1)}
            title={`Sort ${spell.spellId} (lvl ${spell.level}) — ${spell.apCost} PA, portée ${spell.rangeMin === spell.rangeMax ? spell.rangeMin : `${spell.rangeMin}-${spell.rangeMax}`}${onCooldown ? ` · ${spell.cooldownRemaining} tour(s) restant(s)` : ""}`}
            onClick={() => onSelect(spell.spellId)}
          >
            <span className="font-[Verdana,sans-serif] text-[calc(10px*var(--resolution-factor))] font-bold text-[#ad9e7e]">
              {spell.spellId}
            </span>
          </SpellSlot>
        );
      })}
    </div>
  );
}
