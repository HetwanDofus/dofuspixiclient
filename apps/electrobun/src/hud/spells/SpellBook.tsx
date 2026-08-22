import { useCallback, useState } from "react";

import type { GameClient } from "@/game/game-client";

import { SpellDetailPanel } from "./SpellDetailPanel";
import { SpellsPanel } from "./SpellsPanel";

interface SpellBookProps {
  zoom: number;
  gameClient: GameClient | null;
  onClose: () => void;
}

/**
 * The spell book as a whole: the "Tes sorts" list on the right, and —
 * once a spell is selected — its detail window opening to the left of
 * it, both top-aligned. That is the arrangement of the retail window
 * pair; neither panel is useful without the other.
 *
 * The two are siblings rather than parent/child so the list keeps
 * rendering (and stays scrollable) while the detail panel is fetching.
 */
export function SpellBook({ zoom, gameClient, onClose }: SpellBookProps) {
  const [selectedSpellId, setSelectedSpellId] = useState<number | null>(null);

  const selectSpell = useCallback(
    (spellId: number) => {
      setSelectedSpellId((current) => (current === spellId ? null : spellId));
      gameClient?.requestSpellDetails(spellId);
    },
    [gameClient]
  );

  const upgradeSpell = useCallback(
    (spellId: number) => {
      // Ask for the level table *before* sending the upgrade. Both calls
      // mark the spell pending, and `requestSpellDetails` skips a spell
      // that already is — so doing it the other way round means a spell
      // upgraded straight from the list without ever being opened never
      // gets its details, and the panel sits on "Chargement…".
      gameClient?.requestSpellDetails(spellId);
      gameClient?.upgradeSpell(spellId);
      // Opening the spell as it levels mirrors retail: you see the new
      // level's effects immediately after spending the points.
      setSelectedSpellId(spellId);
    },
    [gameClient]
  );

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: zoom * 10,
        pointerEvents: "auto",
        // Both panels are fixed-size transcriptions; letting flex shrink
        // them would break every measured offset inside.
        flexShrink: 0,
      }}
    >
      {selectedSpellId !== null && (
        <SpellDetailPanel
          spellId={selectedSpellId}
          zoom={zoom}
          onClose={() => setSelectedSpellId(null)}
        />
      )}
      <SpellsPanel
        zoom={zoom}
        onClose={onClose}
        selectedSpellId={selectedSpellId}
        onSelectSpell={selectSpell}
        onUpgradeSpell={upgradeSpell}
      />
    </div>
  );
}
