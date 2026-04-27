"use client";

import { cn } from "@/lib/utils";

import { TimelinePip } from "./icons/fight/timeline-pip";

export type TurnTimelineEntry = {
  id: string;
  name: string;
  level?: number;
  team: "ally" | "enemy";
  active?: boolean;
  dead?: boolean;
  /** 0-1 HP fraction — renders a micro health bar below each pip. */
  hpFraction?: number;
  ap?: number;
  mp?: number;
};

interface TurnTimelineProps {
  entries: TurnTimelineEntry[];
  currentTurn?: number;
  className?: string;
  onSelect?: (id: string) => void;
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
      {entries.map((entry) => {
        const hp = entry.hpFraction;
        const tooltip = [
          entry.name + (entry.level ? ` (${entry.level})` : ""),
          hp !== undefined
            ? `HP ${Math.round(hp * 100)}%`
            : undefined,
          entry.ap !== undefined || entry.mp !== undefined
            ? `AP ${entry.ap ?? 0} / MP ${entry.mp ?? 0}`
            : undefined,
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <button
            key={entry.id}
            type="button"
            onClick={() => onSelect?.(entry.id)}
            title={tooltip}
            className={cn(
              "relative cursor-pointer outline-none",
              "h-[calc(30px*var(--resolution-factor))]",
              "w-[calc(24px*var(--resolution-factor))]",
              "flex flex-col items-stretch",
              entry.active &&
                "-translate-y-[calc(2px*var(--resolution-factor))] drop-shadow-[0_0_6px_rgba(255,220,140,0.7)]",
            )}
          >
            <TimelinePip
              team={entry.team}
              active={entry.active}
              dead={entry.dead}
              className="h-[calc(22px*var(--resolution-factor))] w-full"
            />
            {hp !== undefined && !entry.dead && (
              <div
                className={cn(
                  "mt-[calc(1px*var(--resolution-factor))]",
                  "h-[calc(3px*var(--resolution-factor))]",
                  "w-full overflow-hidden",
                  "rounded-[1px] bg-black/60 border border-[#201509]",
                )}
              >
                <div
                  className={cn(
                    "h-full",
                    hp > 0.5
                      ? "bg-[#5fbc3a]"
                      : hp > 0.25
                        ? "bg-[#e8a93a]"
                        : "bg-[#d84848]",
                  )}
                  style={{ width: `${Math.max(0, Math.min(1, hp)) * 100}%` }}
                />
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

export { TurnTimeline };
export type { TurnTimelineProps };
