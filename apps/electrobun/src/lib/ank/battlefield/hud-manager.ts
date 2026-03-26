import type { Application } from "pixi.js";

import { Banner } from "@/hud/banner";
import { ConquestPanel } from "@/hud/conquest";
import { initTooltipBounds } from "@/hud/core/tooltip";
import { FriendsPanel } from "@/hud/friends";
import { GuildPanel } from "@/hud/guild";
import { InventoryPanel } from "@/hud/inventory";
import { MountPanel } from "@/hud/mount";
import { QuestsPanel } from "@/hud/quests";
import { SpellsPanel } from "@/hud/spells";
import { StatsPanel } from "@/hud/stats";
import { WorldMapPanel } from "@/hud/worldmap";

import type { InteractionHandler } from "./interaction-handler";

export class HudManager {
  private banner: Banner | null = null;
  private statsPanel: StatsPanel | null = null;
  private spellsPanel: SpellsPanel | null = null;
  private inventoryPanel: InventoryPanel | null = null;
  private questsPanel: QuestsPanel | null = null;
  private friendsPanel: FriendsPanel | null = null;
  private guildPanel: GuildPanel | null = null;
  private mountPanel: MountPanel | null = null;
  private conquestPanel: ConquestPanel | null = null;
  private worldMapPanel: WorldMapPanel | null = null;

  private currentMapId: number | null = null;
  private interactionHandler: InteractionHandler | null = null;

  private onMinimapTeleportCallback?: (mapId: number) => void;
  private onBoostStatCallback?: (statId: number) => void;
  private onSitToggleCallback?: () => void;

  constructor(
    private app: Application,
    private baseZoom: number,
    private displayHeight: number,
    _interactionHandler: InteractionHandler | null
  ) {}

  setInteractionHandler(handler: InteractionHandler | null): void {
    this.interactionHandler = handler;
  }

  async init(): Promise<void> {
    this.banner = new Banner(this.app, this.displayHeight);
    this.banner.init(this.app.screen.width, this.baseZoom);
    this.banner.setOnMinimapTeleport((mapId) => {
      this.onMinimapTeleportCallback?.(mapId);
    });
    // Wire banner button toggles with mutual exclusion
    this.banner.setOnStatsToggle(() => this.togglePanel("stats"));
    this.banner.setOnSpellsToggle(() => this.togglePanel("spells"));
    this.banner.setOnInventoryToggle(() => this.togglePanel("inventory"));
    this.banner.setOnQuestsToggle(() => this.togglePanel("quests"));
    this.banner.setOnMapToggle(() => this.toggleWorldMap());
    this.banner.setOnFriendsToggle(() => this.togglePanel("friends"));
    this.banner.setOnGuildToggle(() => this.togglePanel("guild"));
    this.banner.setOnMountToggle(() => this.togglePanel("mount"));
    this.banner.setOnConquestToggle(() => this.togglePanel("conquest"));
    this.banner.setOnSitToggle(() => this.onSitToggleCallback?.());

    // World map panel — covers the game render area (below banner z-order)
    this.worldMapPanel = new WorldMapPanel(this.app);
    const gameAreaH = Math.floor(this.displayHeight * this.baseZoom);
    this.worldMapPanel.setArea(this.app.screen.width, gameAreaH);
    this.worldMapPanel.setOnTeleport((mapId) => {
      this.onMinimapTeleportCallback?.(mapId);
    });
    this.worldMapPanel.setOnClose(() => {
      if (this.interactionHandler) {
        this.interactionHandler.enabled = true;
      }
    });
    this.app.stage.addChild(this.worldMapPanel.container);

    // Banner — always on top of world map
    this.app.stage.addChild(this.banner.getGraphics());

    // Create all panels — anchored above the banner
    this.statsPanel = new StatsPanel(this.baseZoom);
    this.statsPanel.setOnBoostStat((statId) => {
      this.onBoostStatCallback?.(statId);
    });
    this.app.stage.addChild(this.statsPanel.container);

    this.spellsPanel = new SpellsPanel(this.baseZoom);
    this.app.stage.addChild(this.spellsPanel.container);

    this.inventoryPanel = new InventoryPanel(this.baseZoom);
    this.app.stage.addChild(this.inventoryPanel.container);

    this.questsPanel = new QuestsPanel(this.baseZoom);
    this.app.stage.addChild(this.questsPanel.container);

    this.friendsPanel = new FriendsPanel(this.baseZoom);
    this.app.stage.addChild(this.friendsPanel.container);

    this.guildPanel = new GuildPanel(this.baseZoom);
    this.app.stage.addChild(this.guildPanel.container);

    this.mountPanel = new MountPanel(this.baseZoom);
    this.app.stage.addChild(this.mountPanel.container);

    this.conquestPanel = new ConquestPanel(this.baseZoom);
    this.app.stage.addChild(this.conquestPanel.container);

    this.updatePositions();

    initTooltipBounds(this.app);
  }

  /** Resolves when banner assets are fully loaded and drawn. */
  async waitForBannerLoaded(): Promise<void> {
    await this.banner?.whenLoaded();
  }

  updateMinimapPosition(mapId: number): void {
    this.currentMapId = mapId;
    this.banner?.updateMinimapPosition(mapId);
  }

  setOnMinimapTeleport(callback: (mapId: number) => void): void {
    this.onMinimapTeleportCallback = callback;
  }

  setOnBoostStat(callback: (statId: number) => void): void {
    this.onBoostStatCallback = callback;
  }

  setOnSitToggle(callback: () => void): void {
    this.onSitToggleCallback = callback;
  }

  onBannerResize(event: { zoom: number; baseZoom: number; screenWidth: number; screenHeight: number }): void {
    this.banner?.onResize(event);
  }

  getStatsPanel(): StatsPanel | null {
    return this.statsPanel;
  }

  getInventoryPanel(): InventoryPanel | null {
    return this.inventoryPanel;
  }

  getWorldMapPanel(): WorldMapPanel | null {
    return this.worldMapPanel;
  }

  /**
   * Check if a screen point falls over an open UI panel.
   */
  isPointOverUI(x: number, y: number): boolean {
    if (this.worldMapPanel?.isVisible()) {
      return true;
    }
    const panels = [
      this.statsPanel,
      this.spellsPanel,
      this.inventoryPanel,
      this.questsPanel,
      this.friendsPanel,
      this.guildPanel,
      this.mountPanel,
      this.conquestPanel,
    ];
    for (const panel of panels) {
      if (panel?.isVisible()) {
        const bounds = panel.container.getBounds();
        if (
          x >= bounds.x &&
          x <= bounds.x + bounds.width &&
          y >= bounds.y &&
          y <= bounds.y + bounds.height
        ) {
          return true;
        }
      }
    }
    return false;
  }

  /** All managed panels mapped to their banner button key */
  private get panelMap() {
    return {
      stats: { panel: this.statsPanel },
      spells: { panel: this.spellsPanel },
      inventory: { panel: this.inventoryPanel },
      quests: { panel: this.questsPanel },
      friends: { panel: this.friendsPanel },
      guild: { panel: this.guildPanel },
      mount: { panel: this.mountPanel },
      conquest: { panel: this.conquestPanel },
    } as const;
  }

  private closeAllPanels(): void {
    const map = this.panelMap;
    const keys = Object.keys(map) as Array<keyof typeof map>;
    for (const key of keys) {
      const { panel } = map[key];
      if (panel?.isVisible()) {
        panel.hide();
      }
    }
  }

  private togglePanel(key: keyof HudManager["panelMap"]): void {
    const map = this.panelMap;
    const entry = map[key];
    const wasVisible = entry.panel?.isVisible();
    this.closeAllPanels();
    if (!wasVisible) {
      entry.panel?.show();
    }
  }

  private updatePositions(): void {
    const zoom = this.baseZoom;
    const bannerY = Math.floor(this.displayHeight * zoom);

    // Update world map panel area
    this.worldMapPanel?.setArea(this.app.screen.width, bannerY);

    // Position each panel above the banner, right-aligned
    const screenW = this.app.screen.width;
    const positionPanel = (
      panel: {
        rebuild: (z: number) => void;
        setPosition: (x: number, y: number) => void;
        panelW: number;
        panelH: number;
      } | null
    ) => {
      if (!panel) return;
      panel.rebuild(zoom);
      panel.setPosition(
        Math.round(screenW - panel.panelW - 4),
        Math.round(bannerY - panel.panelH)
      );
    };

    positionPanel(this.statsPanel);
    positionPanel(this.spellsPanel);
    positionPanel(this.inventoryPanel);
    positionPanel(this.questsPanel);
    positionPanel(this.friendsPanel);
    positionPanel(this.guildPanel);
    positionPanel(this.mountPanel);
    positionPanel(this.conquestPanel);
  }

  toggleWorldMap(): void {
    this.closeAllPanels();
    const wasVisible = this.worldMapPanel?.isVisible() ?? false;
    this.worldMapPanel?.toggle(this.currentMapId ?? undefined);
    if (this.interactionHandler) {
      this.interactionHandler.enabled = wasVisible;
    }
  }

  destroy(): void {
    this.statsPanel?.destroy();
    this.statsPanel = null;
    this.spellsPanel?.destroy();
    this.spellsPanel = null;
    this.inventoryPanel?.destroy();
    this.inventoryPanel = null;
    this.questsPanel?.destroy();
    this.questsPanel = null;
    this.friendsPanel?.destroy();
    this.friendsPanel = null;
    this.guildPanel?.destroy();
    this.guildPanel = null;
    this.mountPanel?.destroy();
    this.mountPanel = null;
    this.conquestPanel?.destroy();
    this.conquestPanel = null;
    this.worldMapPanel?.destroy();
    this.worldMapPanel = null;
    this.banner?.destroy();
    this.banner = null;
  }
}
