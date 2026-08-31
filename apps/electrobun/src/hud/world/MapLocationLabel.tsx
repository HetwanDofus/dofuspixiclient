"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { getMapCoords } from "@/game/input/map-coordinates";
import {
  getMapLangCoords,
  getMapNames,
  loadMapsLang,
} from "@/game/lang/maps-lang";
import { hudStore } from "@/game/stores";
import { useFightMode } from "@/hud/fight/useFightMode";
import { cn } from "@/lib/utils";

/**
 * The location caption 1.29 anchors to the top-left of the play area:
 *
 *     Incarnam (Pitons rocheux)
 *     Coordonnées : 1, -17 - (7365)
 *
 * Everything it needs is client-side. The map id and the server's subarea id
 * come off the `GameMapData` frame via `hudStore`; the names and the world
 * coordinates come from the published `maps` bundle
 * (`game/lang/maps-lang.ts`), with `map-data.json` — already preloaded for
 * map transitions — as the coordinate fallback for a map the retail bundle
 * never listed.
 *
 * Hidden in combat, like retail: the fight HUD owns the play area then.
 */
export function MapLocationLabel() {
  const { minimapMapId, currentSubareaId } = useSyncExternalStore(
    hudStore.subscribe,
    hudStore.getSnapshot
  );
  const { isFighting } = useFightMode();
  const [langReady, setLangReady] = useState(false);

  useEffect(() => {
    let alive = true;
    void loadMapsLang().then(() => {
      if (alive) {
        setLangReady(true);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  if (isFighting || minimapMapId === null) {
    return null;
  }

  // The bundle lookups are synchronous once loaded, so `langReady` is what
  // re-renders the caption when the fetch lands; before that we still show
  // the coordinates line from `map-data.json`.
  const names = langReady ? getMapNames(minimapMapId, currentSubareaId) : null;
  const coords =
    (langReady ? getMapLangCoords(minimapMapId) : null) ??
    getMapCoords(minimapMapId);

  const coordsText = coords
    ? `Coordonnées : ${coords.x}, ${coords.y} - (${minimapMapId})`
    : `Coordonnées : (${minimapMapId})`;

  return (
    <div
      role="presentation"
      className={cn(
        "pointer-events-none select-none whitespace-pre",
        "rounded-[calc(3px*var(--resolution-factor,1))]",
        "bg-black/70",
        "py-[calc(3px*var(--resolution-factor,1))]",
        "px-[calc(5px*var(--resolution-factor,1))]",
        "font-[DofusVerdana,Verdana,sans-serif] font-bold text-white",
        "text-[calc(10px*var(--resolution-factor,1))] leading-[1.3]",
        "[font-synthesis:none]",
        "[font-kerning:none]",
        "[font-feature-settings:'kern'_0]",
        "[font-variant-ligatures:none]"
      )}
    >
      {names && (
        <div>
          {names.areaName} ({names.subareaName})
        </div>
      )}
      <div>{coordsText}</div>
    </div>
  );
}
