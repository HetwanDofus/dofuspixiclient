import { useSyncExternalStore } from "react";

import type { GameClient } from "@/game/game-client";
import { fightActor } from "@/game/stores/fight-store";
import { DISPLAY_HEIGHT, FULL_HEIGHT } from "@/game/constants/battlefield";
import { characterStore, closeAllPanels, hudStore } from "@/game/stores";

import { BannerReact } from "./banner/BannerReact";
import { TooltipProvider } from "./components/Tooltip";
import { ConquestPanel } from "./conquest/ConquestPanel";
import { DamagePoints } from "./fight/DamagePoints";
import { FightEndDialog } from "./fight/FightEndDialog";
import { FightOverlay } from "./fight/FightOverlay";
import { FriendsPanel } from "./friends/FriendsPanel";
import { GameContextMenu } from "./GameContextMenu";
import { GuildPanel } from "./guild/GuildPanel";
import { InventoryPanel } from "./inventory/InventoryPanel";
import { MountPanel } from "./mount/MountPanel";
import { QuestsPanel } from "./quests/QuestsPanel";
import { SpellBook } from "./spells/SpellBook";
import { StatsPanel } from "./stats/StatsPanel";
import { WorldMapPanel } from "./worldmap/WorldMapPanel";
import { MonsterGroupTooltip } from "./world/MonsterGroupTooltip";
import { PlayerNameplate } from "./world/PlayerNameplate";

interface HudOverlayProps {
  baseZoom: number;
  /** Measured canvas offset within the .map-renderer container */
  canvasRect: { left: number; top: number; w: number; h: number };
  gameClient: GameClient | null;
}

export function HudOverlay({
  baseZoom,
  canvasRect,
  gameClient,
}: HudOverlayProps) {
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
            <SpellBook
              zoom={baseZoom}
              gameClient={gameClient}
              onClose={() => closeAllPanels()}
            />
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

        {/* Floating damage / AP / MP / heal numbers — positioned in
            canvas-relative px by the DamageRenderer at spawn time and
            animated via GPU-composited CSS transforms (no Pixi text
            rasterisation). */}
        <DamagePoints />

        {/* World-space sprite name boxes — canonical TextOverHead.
            Anchored in canvas-relative px by PlayerRenderer; the
            store updates positions per-tick so they follow movement
            and camera pans without DOM-side rAF. */}
        <PlayerNameplate />

        <BannerReact
          {...(gameClient
            ? { onSelectSpell: (spellId) => gameClient.fightSelectSpell(spellId) }
            : {})}
        />

        {gameClient && (
          <FightOverlay
            actions={{
              onPassTurn: () => gameClient.fightPassTurn(),
              onForfeit: () => gameClient.fightForfeit(),
              onReady: () => gameClient.fightReady(),
              // Spell selection now lives on the main banner grid
              // (BannerReact). FightOverlay no longer renders its own
              // spell bar — the banner doubles as the in-fight cast UI.
              onSelectSpell: (spellId) => gameClient.fightSelectSpell(spellId),
            }}
          />
        )}
        <FightEndDialog
          onClose={() => {
            // Local-only dismissal — the server already emitted GameEnd
            // and tore down the fight on its side. Sending gameLeave
            // here would either (a) be ignored because the fight is
            // already cleaned up, or (b) make the gateway think we
            // want to forfeit a still-active fight, which on some
            // server states never replies and leaves the dialog
            // unable to advance. LEAVE transitions the local
            // fightActor "ended" → "none", which dismisses the dialog
            // and re-enables the roleplay HUD.
            fightActor.send({ type: "LEAVE" });
          }}
        />
      </div>

      <MonsterGroupTooltip />
      <GameContextMenu />
    </TooltipProvider>
  );
}
