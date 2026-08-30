import { useSyncExternalStore } from "react";

import type { GameClient } from "@/game/game-client";
import { DISPLAY_HEIGHT, FULL_HEIGHT } from "@/game/constants/battlefield";
import { characterStore, closeAllPanels, hudStore } from "@/game/stores";
import { fightActor } from "@/game/stores/fight-store";

import { BannerReact } from "./banner/BannerReact";
import { TooltipProvider } from "./components/Tooltip";
import { ConquestPanel } from "./conquest/ConquestPanel";
import { StorageWindow } from "./exchange/StorageWindow";
import { TradeRequestDialog } from "./exchange/TradeRequestDialog";
import { TradeWindow } from "./exchange/TradeWindow";
import { DamagePoints } from "./fight/DamagePoints";
import { FightEndDialog } from "./fight/FightEndDialog";
import { FightOverlay } from "./fight/FightOverlay";
import { FriendsPanel } from "./friends/FriendsPanel";
import { GameContextMenu } from "./GameContextMenu";
import { GuildPanel } from "./guild/GuildPanel";
import { InventoryWindow } from "./inventory/InventoryWindow";
import { MountPanel } from "./mount/MountPanel";
import { NpcDialog } from "./npc/NpcDialog";
import { QuestsPanel } from "./quests/QuestsPanel";
import { SpellBook } from "./spells/SpellBook";
import { StatsPanel } from "./stats/StatsPanel";
import { ChatBubble } from "./world/ChatBubble";
import { MonsterGroupTooltip } from "./world/MonsterGroupTooltip";
import { PlayerNameplate } from "./world/PlayerNameplate";
import { WorldMapPanel } from "./worldmap/WorldMapPanel";

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

  const { name, level, classId, gfxId, color1, color2, color3, stats } =
    useSyncExternalStore(characterStore.subscribe, characterStore.getSnapshot);

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
              gfxId={gfxId}
              colors={[color1, color2, color3]}
              zoom={baseZoom}
              onClose={() => closeAllPanels()}
              onBoostStat={(statId) => gameClient?.boostStat(statId)}
            />
          </div>
        )}

        {activePanel === "inventory" && (
          <div style={panelWrapStyle}>
            <InventoryWindow
              zoom={baseZoom}
              onClose={() => closeAllPanels()}
              gameClient={gameClient}
            />
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
        <ChatBubble />

        {/* Top left of the play area, where 1.29 anchors it — the bubble is
            deliberately out of the way of the cell the player is standing on.
            Server-driven: it opens on DC and closes on DV, so it sits outside
            the `activePanel` rotation the keyboard panels share — talking to
            an NPC must not close the inventory, and vice versa. */}
        <div
          style={{
            position: "absolute",
            left: 8,
            top: 8,
            pointerEvents: "none",
          }}
        >
          <NpcDialog gameClient={gameClient} zoom={baseZoom} />
        </div>

        {/* Same reasoning as the dialogue bubble above: the bank is
            server-driven — it opens on EC and closes on EV — so it sits
            outside the `activePanel` rotation. Clicking a chest must not
            close the inventory the player is comparing against, and 1.29
            shows the two side by side for exactly that reason. */}
        <div style={panelWrapStyle}>
          <StorageWindow zoom={baseZoom} gameClient={gameClient} />
        </div>

        {/* And the trade, for the same reason plus one: it carries its
            own inventory grid, so it must not evict the bag panel the
            player may already have open beside it. Outside
            `panelWrapStyle`, which pins a single window to the right
            edge — retail spreads the trade's three windows across the
            play area, so it places itself. */}
        <TradeWindow
          zoom={baseZoom}
          gameClient={gameClient}
          playArea={{ width: canvasRect.w, height: bannerTopPx }}
        />

        {/* The proposal boxes. Outside every panel wrapper: they are a
            modal question, not a window, and they centre themselves. */}
        <TradeRequestDialog zoom={baseZoom} gameClient={gameClient} />

        <BannerReact
          {...(gameClient
            ? {
                onSelectSpell: (spellId) =>
                  gameClient.fightSelectSpell(spellId),
              }
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
