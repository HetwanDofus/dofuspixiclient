"use client";

import { useSyncExternalStore } from "react";

import { cn } from "@/lib/utils";

import {
  type PlayerNameplateEntry,
  playerNameplateStore,
} from "./player-nameplate-store";

export function PlayerNameplate() {
  const { entries } = useSyncExternalStore(
    playerNameplateStore.subscribe,
    playerNameplateStore.getSnapshot
  );

  if (entries.length === 0) {
    return null;
  }

  return (
    <>
      {entries.map((entry) => (
        <NameplateBox key={entry.id} entry={entry} />
      ))}
    </>
  );
}

function NameplateBox({ entry }: { entry: PlayerNameplateEntry }) {
  return (
    <div
      role="presentation"
      className={cn(
        "pointer-events-none absolute select-none whitespace-pre",
        "rounded-[calc(3px*var(--resolution-factor,1))]",
        "bg-black/70",
        "pt-[calc(3px*var(--resolution-factor,1))]",
        "pb-[calc(5px*var(--resolution-factor,1))]",
        "px-[calc(4px*var(--resolution-factor,1))]",
        "font-[DofusVerdana,Verdana,sans-serif] font-bold text-white",
        "text-[calc(10px*var(--resolution-factor,1))] leading-[1.2] text-center",
        "[font-synthesis:none]",
        "tracking-wide",
        "[font-kerning:none]",
        "[font-feature-settings:'kern'_0]",
        "[font-variant-ligatures:none]"
      )}
      style={{
        left: entry.anchorX,
        top: entry.anchorY,
        transform: "translate(-50%, -100%)",
      }}
    >
      {entry.name}
    </div>
  );
}
