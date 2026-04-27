"use client";

import { useSyncExternalStore } from "react";

import { characterStore } from "@/game/stores/character-store";
import { monsterGroupHoverStore } from "@/hud/world/monster-group-hover-store";
import { cn } from "@/lib/utils";

/**
 * World-map monster-group roster tooltip. Visible when the cursor is
 * over a SPRITE_TYPE_MONSTER_GROUP sprite — lists every member with
 * name + level and computes a difficulty color from the sum of levels
 * versus the local player's level (green = easy, red = risky).
 *
 * The tooltip positions itself in canvas-relative space using the
 * coordinates published by BattlefieldPicking's hover handler; no
 * cursor tracking here because the picker's own dirty-rect throttles
 * events enough to avoid jitter.
 */
export function MonsterGroupTooltip() {
  const { group } = useSyncExternalStore(
    monsterGroupHoverStore.subscribe,
    monsterGroupHoverStore.getSnapshot
  );
  const character = useSyncExternalStore(
    characterStore.subscribe,
    characterStore.getSnapshot
  );

  if (!group || group.members.length === 0) {
    return null;
  }

  const totalLevel = group.members.reduce((s, m) => s + m.level, 0);
  const playerLevel = character.level ?? 1;
  const ratio = totalLevel / Math.max(1, playerLevel);
  const difficulty =
    ratio < 0.75 ? "easy" : ratio < 1.2 ? "even" : ratio < 2 ? "hard" : "deadly";
  const diffColor =
    difficulty === "easy"
      ? "text-[#7bd66c] border-[#4a7b3a]"
      : difficulty === "even"
        ? "text-[#e8d566] border-[#8a7a3a]"
        : difficulty === "hard"
          ? "text-[#e89a3a] border-[#8a5a20]"
          : "text-[#e84848] border-[#7a2020]";

  return (
    <div
      role="tooltip"
      className={cn(
        "pointer-events-none fixed z-30",
        "translate-x-[calc(12px*var(--resolution-factor))] -translate-y-1/2",
        "rounded-[calc(4px*var(--resolution-factor))]",
        "border bg-[#1a1610]/95",
        "px-[calc(6px*var(--resolution-factor))]",
        "py-[calc(4px*var(--resolution-factor))]",
        "font-[Verdana,sans-serif]",
        "text-[calc(10px*var(--resolution-factor))]",
        "text-[#d5cfaa]",
        diffColor.split(" ")[1] ?? "border-[#402b15]",
      )}
      style={{ left: group.x, top: group.y }}
    >
      <div className="flex items-center gap-[calc(6px*var(--resolution-factor))] pb-[calc(3px*var(--resolution-factor))] border-b border-[#402b15]">
        <span className="font-bold">Groupe de monstres</span>
        <span className={cn("text-[calc(9px*var(--resolution-factor))] font-bold tabular-nums", diffColor.split(" ")[0])}>
          Niv. total {totalLevel}
        </span>
      </div>
      <ul className="mt-[calc(3px*var(--resolution-factor))] space-y-[calc(1px*var(--resolution-factor))]">
        {group.members.map((m, i) => (
          <li
            // templateId repeats in a group — key on index too.
            key={`${m.templateId}-${i}`}
            className="flex items-center gap-[calc(6px*var(--resolution-factor))] tabular-nums"
          >
            <span className="flex-1">{m.name}</span>
            <span className="text-[#9ee2ff]">Niv. {m.level}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
