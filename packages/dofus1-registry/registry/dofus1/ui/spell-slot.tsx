"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { SpellSlotFrame } from "./icons/fight/spell-slot-frame";

type SpellSlotState = "ready" | "disabled" | "selected" | "cooldown";

interface SpellSlotProps {
  state?: SpellSlotState;
  cooldown?: number;
  shortcut?: string;
  onClick?: () => void;
  title?: string;
  className?: string;
  children?: ReactNode;
}

function SpellSlot({
  state = "ready",
  cooldown,
  shortcut,
  onClick,
  title,
  className,
  children,
}: SpellSlotProps) {
  const effectiveState: SpellSlotState =
    cooldown && cooldown > 0 ? "cooldown" : state;
  const disabled =
    effectiveState === "disabled" || effectiveState === "cooldown";
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      title={title}
      aria-disabled={disabled || undefined}
      className={cn(
        "relative inline-flex items-center justify-center outline-none",
        "h-[calc(40px*var(--resolution-factor))]",
        "w-[calc(40px*var(--resolution-factor))]",
        !disabled && "cursor-pointer hover:brightness-110",
        disabled && "cursor-not-allowed",
        className,
      )}
    >
      <SpellSlotFrame state={effectiveState} className="absolute inset-0" />
      <span
        className={cn(
          "relative z-10 flex h-full w-full items-center justify-center",
          effectiveState === "disabled" && "opacity-40 grayscale",
        )}
      >
        {children}
      </span>
      {shortcut && (
        <span className="pointer-events-none absolute bottom-[calc(1px*var(--resolution-factor))] left-[calc(2px*var(--resolution-factor))] z-20 font-[Verdana,sans-serif] text-[calc(7px*var(--resolution-factor))] leading-none font-bold text-white [text-shadow:0_0_2px_black]">
          {shortcut}
        </span>
      )}
      {effectiveState === "cooldown" && cooldown !== undefined && (
        <span className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-[calc(3px*var(--resolution-factor))] bg-black/60 font-[Verdana,sans-serif] text-[calc(14px*var(--resolution-factor))] font-bold text-white tabular-nums">
          {cooldown}
        </span>
      )}
    </button>
  );
}

export { SpellSlot };
export type { SpellSlotProps, SpellSlotState };
