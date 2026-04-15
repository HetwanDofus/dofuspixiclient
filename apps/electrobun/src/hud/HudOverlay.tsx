import { useSyncExternalStore } from "react";

import { DISPLAY_HEIGHT, FULL_HEIGHT } from "@/game/constants/battlefield";
import { characterStore, closeAllPanels, hudStore } from "@/game/stores";

import { BannerReact } from "./banner/BannerReact";
import { TooltipProvider } from "./components/Tooltip";
import { ConquestPanel } from "./conquest/ConquestPanel";
import { FriendsPanel } from "./friends/FriendsPanel";
import { GameContextMenu } from "./GameContextMenu";
import { GuildPanel } from "./guild/GuildPanel";
import { InventoryPanel } from "./inventory/InventoryPanel";
import { MountPanel } from "./mount/MountPanel";
import { QuestsPanel } from "./quests/QuestsPanel";
import { SpellsPanel } from "./spells/SpellsPanel";
import { StatsPanel } from "./stats/StatsPanel";
import { WorldMapPanel } from "./worldmap/WorldMapPanel";

interface HudOverlayProps {
  baseZoom: number;
  /** Measured canvas offset within the .map-renderer container */
  canvasRect: { left: number; top: number; w: number; h: number };
}

export function HudOverlay({ baseZoom, canvasRect }: HudOverlayProps) {
  const { activePanel, isWorldMapOpen } = useSyncExternalStore(
    hudStore.subscribe,
    hudStore.getSnapshot
  );

  const { name, level, classId, stats } = useSyncExternalStore(
    characterStore.subscribe,
    characterStore.getSnapshot
  );

  // Use the measured canvas rect for width/height (CSS pixels, accounts for autoDensity).
  // Banner top is at DISPLAY_HEIGHT/FULL_HEIGHT fraction of the canvas height.
  const bannerTopPx = canvasRect.h * (DISPLAY_HEIGHT / FULL_HEIGHT);

  const panelWrapStyle: React.CSSProperties = {
    position: "absolute",
    right: 4,
    top: 0,
    height: bannerTopPx,
    display: "flex",
    alignItems: "flex-end",
    pointerEvents: "auto",
  };

  return (
    <TooltipProvider>
      <div
        style={{
          position: "absolute",
          left: canvasRect.left,
          top: canvasRect.top,
          width: canvasRect.w,
          height: canvasRect.h,
          pointerEvents: "none",
          zIndex: 10,
        }}
      >
        {activePanel === "stats" && (
          <div style={panelWrapStyle}>
            <StatsPanel
              stats={stats}
              name={name}
              level={level}
              classId={classId}
              zoom={baseZoom}
              onClose={() => closeAllPanels()}
              onBoostStat={(stat) => console.log("Boost stat:", stat)}
            />
          </div>
        )}

        {activePanel === "inventory" && (
          <div style={panelWrapStyle}>
            <InventoryPanel zoom={baseZoom} onClose={() => closeAllPanels()} />
          </div>
        )}

        {activePanel === "spells" && (
          <div style={panelWrapStyle}>
            <SpellsPanel zoom={baseZoom} onClose={() => closeAllPanels()} />
          </div>
        )}

        {activePanel === "quests" && (
          <div style={panelWrapStyle}>
            <QuestsPanel zoom={baseZoom} onClose={() => closeAllPanels()} />
          </div>
        )}

        {activePanel === "friends" && (
          <div style={panelWrapStyle}>
            <FriendsPanel zoom={baseZoom} onClose={() => closeAllPanels()} />
          </div>
        )}

        {activePanel === "guild" && (
          <div style={panelWrapStyle}>
            <GuildPanel zoom={baseZoom} onClose={() => closeAllPanels()} />
          </div>
        )}

        {activePanel === "mount" && (
          <div style={panelWrapStyle}>
            <MountPanel zoom={baseZoom} onClose={() => closeAllPanels()} />
          </div>
        )}

        {activePanel === "conquest" && (
          <div style={panelWrapStyle}>
            <ConquestPanel zoom={baseZoom} onClose={() => closeAllPanels()} />
          </div>
        )}

        <WorldMapPanel
          visible={isWorldMapOpen}
          zoom={baseZoom}
          canvasWidth={canvasRect.w}
          canvasHeight={canvasRect.h}
        />

        <BannerReact />
      </div>

      <GameContextMenu />
    </TooltipProvider>
  );
}
