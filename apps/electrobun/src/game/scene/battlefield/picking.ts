import type { MonsterGroupMember } from "@dofus/proto";
import type { Application, Sprite } from "pixi.js";

import type { PickingSystem } from "@/game/render/picking-system";
import type { PlayerRenderer } from "@/game/scene/player/renderer";
import type { InteractiveObjectData, PickResult } from "@/game/types";
import {
  hideContextMenu,
  showContextMenu,
} from "@/game/stores/context-menu-store";
import {
  clearMonsterGroupHover,
  setMonsterGroupHover,
} from "@/hud/world/monster-group-hover-store";
import { createLogger } from "@/utils/logger";

const log = createLogger("BattlefieldPicking");

/** Zaap interactive object type (from interactive-objects.json). */
const ZAAP_TYPE = 3;

export interface BattlefieldPickingDeps {
  pickingSystem(): PickingSystem | null;
  interactiveObjects(): Map<number, InteractiveObjectData>;
  worldActorRenderer(): PlayerRenderer | null;
  app(): Application | null;
  /**
   * Fired when a clickable that resolves to a cell ID is clicked
   * (currently used for monster-group sprites). The game client uses
   * this to route a walk-to-cell request which trips the server-side
   * PvM auto-trigger on cell arrival.
   */
  onCellPickThrough?: (cellId: number) => void;
}

interface InteractiveCallbacks {
  onHover: ((hovered: boolean) => void) | null;
  onClick: (() => void) | null;
}

/**
 * Owns all picking-system bookkeeping for the battlefield:
 *   - maps between pickable IDs and (gfxId | playerId)
 *   - per-pickable hover/click callbacks
 *   - click routing to context menus (player / zaap / tile)
 *   - hover routing to nameplate show/hide
 */
export class BattlefieldPicking {
  private nextPickableId = 1;
  private readonly pickableIdToGfxId = new Map<number, number>();
  private readonly pickableIdToPlayerId = new Map<number, number>();
  private readonly playerIdToPickableId = new Map<number, number>();
  private readonly callbacks = new Map<number, InteractiveCallbacks>();
  // pickableId → monster-group roster, populated when a SPRITE_TYPE_
  // MONSTER_GROUP actor is registered. The hover callback reads this
  // and publishes to monsterGroupHoverStore so the React tooltip can
  // render the member list.
  private readonly pickableIdToMonsterGroup = new Map<
    number,
    MonsterGroupMember[]
  >();
  private readonly pickableIdToPlayerName = new Map<number, string>();
  private lastHoveredPickableId: number | undefined;

  constructor(private readonly deps: BattlefieldPickingDeps) {}

  /** Register an interactive tile (zaap, door, etc). Returns the pickable ID. */
  registerTile(sprite: Sprite, gfxId: number): number {
    const pickableId = this.nextPickableId++;
    const pickingSystem = this.deps.pickingSystem();

    if (!pickingSystem) {
      return pickableId;
    }

    pickingSystem.registerObject({ id: pickableId, sprite });
    this.pickableIdToGfxId.set(pickableId, gfxId);
    return pickableId;
  }

  /** Register a world actor's sprite so clicks/hovers route to it. */
  registerPlayer(
    playerId: number,
    renderer: PlayerRenderer,
    monsterGroup?: MonsterGroupMember[]
  ): void {
    const data = renderer.getPlayerPickingData(playerId);
    const pickingSystem = this.deps.pickingSystem();

    if (!data || !pickingSystem) {
      return;
    }

    const pickableId = this.nextPickableId++;
    pickingSystem.registerObject({
      id: pickableId,
      sprite: data.sprite,
      parentContainer: data.container,
    });

    this.callbacks.set(pickableId, {
      onHover: (hovered) => {
        if (hovered) {
          renderer.showName(playerId);
          this.publishMonsterGroupHover(pickableId, true);
        } else {
          renderer.hideName(playerId);
          this.publishMonsterGroupHover(pickableId, false);
        }
      },
      onClick: null,
    });

    this.playerIdToPickableId.set(playerId, pickableId);
    this.pickableIdToPlayerId.set(pickableId, playerId);

    const displayName = renderer.getPlayerName(playerId);
    if (displayName) {
      this.pickableIdToPlayerName.set(pickableId, displayName);
    }
    if (monsterGroup && monsterGroup.length > 0) {
      this.pickableIdToMonsterGroup.set(pickableId, monsterGroup);
    }
  }

  private publishMonsterGroupHover(pickableId: number, hovered: boolean): void {
    if (!hovered) {
      clearMonsterGroupHover();
      return;
    }
    const members = this.pickableIdToMonsterGroup.get(pickableId);
    if (!members || members.length === 0) {
      return;
    }
    const playerId = this.pickableIdToPlayerId.get(pickableId) ?? 0;
    // Approximate a cursor-space position from the last known screen
    // coord if the picking system exposes one, else anchor the tip
    // just above the sprite's container via its global transform.
    const app = this.deps.app();
    const canvas = app?.canvas;
    const rect = canvas?.getBoundingClientRect();
    const x = rect ? rect.left + rect.width / 2 : 0;
    const y = rect ? rect.top + rect.height / 3 : 0;
    setMonsterGroupHover({
      spriteId: String(playerId),
      members: members.map((m) => ({
        templateId: m.templateId,
        name:
          this.pickableIdToPlayerName.get(pickableId) ??
          `Monster ${m.templateId}`,
        level: m.level,
        gfxId: m.gfxId,
      })),
      x,
      y,
    });
  }

  unregisterPlayer(playerId: number): void {
    const pickableId = this.playerIdToPickableId.get(playerId);

    if (pickableId === undefined) {
      return;
    }

    this.deps.pickingSystem()?.unregisterObject(pickableId);
    this.callbacks.delete(pickableId);
    this.playerIdToPickableId.delete(playerId);
    this.pickableIdToPlayerId.delete(pickableId);
    this.pickableIdToMonsterGroup.delete(pickableId);
    this.pickableIdToPlayerName.delete(pickableId);
    if (this.lastHoveredPickableId === pickableId) {
      clearMonsterGroupHover();
      this.lastHoveredPickableId = undefined;
    }
  }

  /** Wipe all tile-level pickables (kept on map reload). */
  clearTiles(): void {
    this.deps.pickingSystem()?.clear();
    this.pickableIdToGfxId.clear();
    this.nextPickableId = 1;
  }

  onObjectClick(result: PickResult): void {
    hideContextMenu();

    const cb = this.callbacks.get(result.object.id);

    if (cb?.onClick) {
      cb.onClick();
    }

    const playerId = this.pickableIdToPlayerId.get(result.object.id);

    if (playerId !== undefined) {
      // Monster groups: primary detection is the roster map populated
      // at register-time from SpriteMovementEntry.monsters[]; we fall
      // back to the legacy negative-id heuristic for pre-rework
      // servers that still emit formatSpriteID(-groupID). Either
      // branch routes the click to the cell pick-through so the
      // player walks to the group's cell and trips the server-side
      // PvM auto-trigger on arrival.
      const isMonsterGroup =
        this.pickableIdToMonsterGroup.has(result.object.id) || playerId < 0;
      if (isMonsterGroup) {
        const cellId = this.deps
          .worldActorRenderer()
          ?.getPlayerCell(playerId);
        if (cellId !== undefined) {
          this.deps.onCellPickThrough?.(cellId);
        }
        return;
      }
      const name =
        this.deps.worldActorRenderer()?.getPlayerName(playerId) ?? "Player";
      this.showPlayerContextMenu(name, result.x, result.y);
      return;
    }

    const gfxId = this.pickableIdToGfxId.get(result.object.id);

    if (!gfxId) {
      return;
    }

    const objData = this.deps.interactiveObjects().get(gfxId);
    log.debug("Clicked interactive object:", gfxId, objData);

    if (objData?.type === ZAAP_TYPE) {
      this.showZaapContextMenu(result.x, result.y);
    }
  }

  onObjectHover(result: PickResult | null): void {
    if (
      this.lastHoveredPickableId !== undefined &&
      this.lastHoveredPickableId !== result?.object.id
    ) {
      this.callbacks.get(this.lastHoveredPickableId)?.onHover?.(false);
      this.lastHoveredPickableId = undefined;
    }

    if (result) {
      const cb = this.callbacks.get(result.object.id);

      if (cb) {
        cb.onHover?.(true);
        this.lastHoveredPickableId = result.object.id;
      }
    }
  }

  /** Convert Pixi-local pointer coords to page coords for HTML context menus. */
  private pixiToPageCoords(
    pixiX: number,
    pixiY: number
  ): { x: number; y: number } {
    const app = this.deps.app();
    const canvas = app?.canvas;

    if (!canvas) {
      return { x: 0, y: 0 };
    }

    const rect = canvas.getBoundingClientRect();
    const resolution = app?.renderer.resolution ?? 1;
    return {
      x: rect.left + pixiX / resolution,
      y: rect.top + pixiY / resolution,
    };
  }

  private showZaapContextMenu(screenX: number, screenY: number): void {
    const { x, y } = this.pixiToPageCoords(screenX, screenY);
    showContextMenu(
      "Zaap",
      [
        {
          label: "Use",
          onClick: () => log.debug("Zaap: Use action triggered"),
        },
      ],
      x,
      y
    );
  }

  private showPlayerContextMenu(
    name: string,
    screenX: number,
    screenY: number
  ): void {
    const { x, y } = this.pixiToPageCoords(screenX, screenY);
    showContextMenu(
      name,
      [
        { label: "Slap", onClick: () => log.debug(`Slap: ${name}`) },
        {
          label: "Organize my shop",
          onClick: () => log.debug(`Shop: ${name}`),
        },
      ],
      x,
      y
    );
  }
}
