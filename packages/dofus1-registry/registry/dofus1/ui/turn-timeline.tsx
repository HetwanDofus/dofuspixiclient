"use client";

import { cn } from "@/lib/utils";

import { TimelinePip } from "./icons/fight/timeline-pip";

export type TurnTimelineEntry = {
  id: number;
  name: string;
  team: "ally" | "enemy";
  active?: boolean;
  dead?: boolean;
};

interface TurnTimelineProps {
  entries: TurnTimelineEntry[];
  currentTurn?: number;
  className?: string;
  onSelect?: (id: number) => void;
}

function TurnTimeline({
  entries,
  currentTurn,
  className,
  onSelect,
}: TurnTimelineProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center",
        "gap-[calc(1px*var(--resolution-factor))]",
        "bg-[#1a1610]/75 rounded-[calc(3px*var(--resolution-factor))]",
        "p-[calc(2px*var(--resolution-factor))]",
        "border border-[#402b15]",
        className,
      )}
    >
      {currentTurn !== undefined && (
        <span className="mr-[calc(4px*var(--resolution-factor))] font-[Verdana,sans-serif] text-[calc(9px*var(--resolution-factor))] font-bold text-white tabular-nums">
          T{currentTurn}
        </span>
      )}
      {entries.map((entry) => (
        <button
          key={entry.id}
          type="button"
          onClick={() => onSelect?.(entry.id)}
          title={entry.name}
          className={cn(
            "relative cursor-pointer outline-none",
            "h-[calc(28px*var(--resolution-factor))]",
            "w-[calc(24px*var(--resolution-factor))]",
            entry.active && "-translate-y-[calc(2px*var(--resolution-factor))]",
          )}
        >
          <TimelinePip
            team={entry.team}
            active={entry.active}
            dead={entry.dead}
            className="h-full w-full"
          />
        </button>
      ))}
    </div>
  );
}

export { TurnTimeline };
export type { TurnTimelineProps };
