import type { MonsterGroupMember } from "@dofus/proto";
import type { Application, Sprite } from "pixi.js";

import type { PickingSystem } from "@/game/render/picking-system";
import type { PlayerRenderer } from "@/game/scene/player/renderer";
import type { InteractiveObjectData, PickResult } from "@/game/types";
import {
  hideContextMenu,
  showContextMenu,
} from "@/game/stores/context-menu-store";
import { IMPLEMENTED_INTERACTIVE_SKILLS } from "@/game/types";
import {
  clearMonsterGroupHover,
  setMonsterGroupHover,
} from "@/hud/world/monster-group-hover-store";
import { createLogger } from "@/utils/logger";

const log = createLogger("BattlefieldPicking");

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
  /**
   * Fired when the player picks an action in an element's menu. The game
   * client walks to the cell first, then sends `GA;500;<cellId>;<skillId>`.
   */
  onInteractiveUse?: (cellId: number, skillId: number) => void;
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
  /**
   * Monotonic, and deliberately never reset. Ids identify entries in the
   * player tables as much as in the tile ones; restarting the count on a
   * map reload hands a fresh door the id a departed actor still owns
   * there, and the door then opens that actor's menu.
   */
  private nextPickableId = 1;
  private readonly pickableIdToGfxId = new Map<number, number>();
  /** pickableId → the cell the element stands on, the id `GA;500` carries. */
  private readonly pickableIdToCellId = new Map<number, number>();
  /** Pickables owned by the tile layers — the set `clearTiles` drops. */
  private readonly tilePickableIds = new Set<number>();
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
  // Per-pickable difficulty bonus that drives the 5-star colouring on
  // the hover panel. Mirrors `MonsterGroup._nBonusValue` from canonical
  // 1.29 (`TextWithTitleOverHead.STARS_COLORS`).
  private readonly pickableIdToMonsterGroupBonus = new Map<number, number>();
  // pickableId → list of player IDs that visually belong to the same
  // monster group (leader + decorative siblings). On hover/un-hover
  // the picking handler iterates the list and highlights every member
  // so the whole stack reads as ONE unit. Without this, hovering one
  // sibling would only tint that one sprite while the rest stayed
  // dark — exactly the bug the user reported.
  private readonly pickableIdToGroupSpriteIds = new Map<number, number[]>();
  private readonly pickableIdToPlayerName = new Map<number, string>();
  // Pickable id of OUR OWN sprite (the one tagged isCurrentPlayer at
  // register time). Used by `setOnSelfHover` to gate the
  // MP-reachable-range overlay behind hovering the avatar — mirrors
  // canonical Sprite._rollOver / _rollOut from the 1.29 client.
  private selfPickableId: number | undefined;
  private onSelfHover: ((hovered: boolean) => void) | null = null;
  /**
   * Pickable currently flagged hovered by the pixel-precise picking
   * system (cursor is over the actual rasterised sprite pixels).
   */
  private pixelHoverPickableId: number | undefined;
  /**
   * Pickable currently flagged hovered by the cell-grid handler
   * (cursor is anywhere inside the diamond of a fighter's cell, even
   * if it missed the tight sprite pixels). Mirrors canonical
   * InteractionCell `onRollOver` — the canonical hover hit area for a
   * fighter is the FULL cell, not the sprite bounds.
   */
  private cellHoverPickableId: number | undefined;
  /**
   * The pickable whose hover callbacks are currently asserted (`true`).
   * Computed as the OR of the two source channels above: a fighter
   * stays hovered as long as the cursor is over EITHER its sprite
   * pixels OR its cell diamond. Without this OR, a small mouse
   * movement that crosses the sprite pixel edge but stays on the
   * cell would fire `onHover(false)` from the pixel path while the
   * cell path is still `true`, snapping the hover effects off — the
   * "hitbox widening doesn't work" symptom.
   */
  private effectiveHoverPickableId: number | undefined;

  constructor(private readonly deps: BattlefieldPickingDeps) {}

  /**
   * Subscribe to hover-on-self. Fires `true` when the local player's
   * sprite is rolled over and `false` on roll-out (or when the player
   * sprite is unregistered while still hovered). Replaces the unconditional
   * MP-range broadcast on turn start so the green pattern only appears
   * while the user actually points at their fighter.
   */
  setOnSelfHover(cb: (hovered: boolean) => void): void {
    this.onSelfHover = cb;
  }

  /**
   * Trigger / clear the via-cell fighter hover. Call this from the
   * cell-hover handler with the new hovered cellId (or `null` when
   * the cursor leaves the grid). Updates the cell channel and lets
   * `recomputeEffectiveHover` decide whether the visible hover
   * actually changes.
   */
  setHoverByCell(cellId: number | null): void {
    let nextPickableId: number | undefined;
    if (cellId !== null) {
      const renderer = this.deps.worldActorRenderer();
      if (renderer) {
        // Find the live fighter standing on this cell. With <16
        // fighters in a typical fight, a linear scan is cheaper than
        // maintaining a parallel cell→playerId index that would have
        // to track teleports / death / removal.
        for (const [playerId, pickableId] of this.playerIdToPickableId) {
          if (renderer.getPlayerCell(playerId) === cellId) {
            nextPickableId = pickableId;
            break;
          }
        }
      }
    }
    if (nextPickableId === this.cellHoverPickableId) {
      return;
    }
    this.cellHoverPickableId = nextPickableId;
    this.recomputeEffectiveHover();
  }

  /**
   * Reduce `pixelHoverPickableId` ⊕ `cellHoverPickableId` to a single
   * "currently hovered" pickable id, then fire roll-in / roll-out
   * callbacks only when the result actually changes. Cell channel
   * wins when both are set on different ids — canonical 1.29 routes
   * fighter hover through the InteractionCell layer first, so when
   * the cell agrees the pixel sample shouldn't override it.
   */
  private recomputeEffectiveHover(): void {
    const next =
      this.cellHoverPickableId ?? this.pixelHoverPickableId ?? undefined;
    if (next === this.effectiveHoverPickableId) {
      return;
    }
    const previous = this.effectiveHoverPickableId;
    this.effectiveHoverPickableId = next;
    if (previous !== undefined) {
      this.callbacks.get(previous)?.onHover?.(false);
    }
    if (next !== undefined) {
      this.callbacks.get(next)?.onHover?.(true);
    }
  }

  /**
   * Register an interactive tile (zaap, door, chest…). The cell id is what the
   * server is told when the player picks an action — `GA;500;<cellId>;<skillId>`
   * names the cell, never the sprite — so it has to be kept here.
   */
  registerTile(sprite: Sprite, gfxId: number, cellId: number): number {
    const pickableId = this.nextPickableId++;
    const pickingSystem = this.deps.pickingSystem();

    if (!pickingSystem) {
      return pickableId;
    }

    pickingSystem.registerObject({ id: pickableId, sprite });
    this.pickableIdToGfxId.set(pickableId, gfxId);
    this.pickableIdToCellId.set(pickableId, cellId);
    this.tilePickableIds.add(pickableId);
    return pickableId;
  }

  /** Register a world actor's sprite so clicks/hovers route to it. */
  registerPlayer(
    playerId: number,
    renderer: PlayerRenderer,
    monsterGroup?: MonsterGroupMember[],
    isCurrentPlayer?: boolean,
    monsterGroupBonus?: number,
    groupSpriteIds?: number[]
  ): void {
    const data = renderer.getPlayerPickingData(playerId);
    const pickingSystem = this.deps.pickingSystem();

    if (!data || !pickingSystem) {
      return;
    }

    // An actor can legitimately be registered twice — a `GM UPDATE`
    // after an equip re-runs the whole add path on a sprite that is
    // already on screen. Dropping the previous pickable first keeps one
    // hover target per actor; without it every re-add left a stale
    // entry answering for the same sprite.
    this.unregisterPlayer(playerId);

    const pickableId = this.nextPickableId++;
    pickingSystem.registerObject({
      id: pickableId,
      sprite: data.sprite,
      parentContainer: data.container,
    });

    const isMonsterGroup =
      Array.isArray(monsterGroup) && monsterGroup.length > 0;
    // Snapshot the sprite-id list at registration time. If the
    // caller didn't supply one (single-monster "group" / NPC /
    // player), fall back to a 1-element array so the hover handler
    // can take the same iteration path for everyone.
    const groupIds: number[] =
      Array.isArray(groupSpriteIds) && groupSpriteIds.length > 0
        ? groupSpriteIds
        : [playerId];

    this.callbacks.set(pickableId, {
      onHover: (hovered) => {
        // Monster groups use the React tooltip exclusively — the
        // canonical world-space nameplate + HP bar would render an
        // empty black panel above the React panel (groups don't have
        // a single "name" or "HP", which is what the panel shows).
        // Skip those for groups; players + summons keep both.
        if (isMonsterGroup) {
          // Tint EVERY sprite in the group together so the stack
          // reads as one unit, not a pile of individual mobs.
          for (const sid of groupIds) {
            renderer.setHoverHighlight(sid, hovered);
          }
          this.publishMonsterGroupHover(pickableId, hovered);
          return;
        }
        // Canonical Dofus 1.29 (DofusBattlefield.onSpriteRollOver,
        // `assets/sources/.../DofusBattlefield.as:839-1063`) splits
        // the overhead overlay between roleplay and fight modes:
        //   - Roleplay: TextOverHead (compact name box).
        //   - Fight   : HealthBarOverHead only — `_loc10_ = ""` at
        //               line 889/910 and the `if(_loc10_ != "")` at
        //               line 1058 skips the TextOverHead branch.
        // Showing both during fights produces a wide stacked overlay
        // (the visible "box is widened" regression). We honour the
        // canonical split here.
        const inFight = renderer.isFightMode();
        if (!inFight) {
          if (hovered) {
            renderer.showName(playerId);
          } else {
            renderer.hideName(playerId);
          }
        }
        // Sprite.select(true) ColorMatrix tint on hover (canonical
        // Sprite.as:93-105: ra:60, rb:102, ga:60, gb:102, ba:60,
        // bb:102 — multiply by 0.6 + offset 0.4). Applies to the
        // sprite only; the team-colour ground circle is untouched
        // in canonical and we keep that behaviour.
        renderer.setHoverHighlight(playerId, hovered);
        renderer.setHpBarVisible(playerId, hovered);
        // Fire the self-hover hook in addition to nameplate / monster-group
        // tooltip side effects. Gated to OUR sprite so foreign hovers
        // never trigger the MP-range tint.
        if (this.selfPickableId === pickableId) {
          this.onSelfHover?.(hovered);
        }
      },
      onClick: null,
    });

    this.playerIdToPickableId.set(playerId, pickableId);
    this.pickableIdToPlayerId.set(pickableId, playerId);
    if (isCurrentPlayer) {
      this.selfPickableId = pickableId;
    }

    const displayName = renderer.getPlayerName(playerId);
    if (displayName) {
      this.pickableIdToPlayerName.set(pickableId, displayName);
    }
    if (monsterGroup && monsterGroup.length > 0) {
      this.pickableIdToMonsterGroup.set(pickableId, monsterGroup);
      this.pickableIdToMonsterGroupBonus.set(
        pickableId,
        monsterGroupBonus ?? 0
      );
    }
    if (groupSpriteIds && groupSpriteIds.length > 0) {
      this.pickableIdToGroupSpriteIds.set(pickableId, groupSpriteIds);
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
    const renderer = this.deps.worldActorRenderer();
    const data = renderer?.getPlayerPickingData(playerId);
    const app = this.deps.app();
    const canvas = app?.canvas;
    const rect = canvas?.getBoundingClientRect();

    let pageX = 0;
    let pageY = 0;
    let side: "left" | "right" = "right";

    if (data && rect) {
      // Project the sprite's world position to canvas-local coords.
      // `Container.getGlobalPosition()` returns the position in the Pixi
      // stage, which after the renderer's projection equals canvas
      // pixel coordinates — that's what `getBoundingClientRect()` adds
      // to in order to land in page space.
      const global = data.container.getGlobalPosition();
      pageX = rect.left + global.x;
      // Anchor the tip slightly above the sprite's feet so the panel
      // sits over the group's heads, matching the original
      // TextWithTitleOverHead placement.
      pageY = rect.top + global.y - 40;

      // Flip to the LEFT when the group's screen X is in the right
      // 35% of the canvas — without this guard the tooltip clips the
      // viewport edge or jumps to the opposite side of the canvas
      // (the "displays at the opposite side of the group" bug).
      const localX = global.x;
      if (localX > rect.width * 0.65) {
        side = "left";
      }
    } else if (rect) {
      // Fallback: keep the legacy "canvas center" behaviour so the
      // tooltip still appears on platforms where projection failed.
      pageX = rect.left + rect.width / 2;
      pageY = rect.top + rect.height / 3;
    }

    setMonsterGroupHover({
      spriteId: String(playerId),
      members: members.map((m) => ({
        templateId: m.templateId,
        // Server now carries each monster's localized template name via the
        // `name` field on MonsterGroupMember (added 2026-04-28). The old
        // "Monster ${templateId}" fallback only fires for legacy clients
        // hitting an unpatched server.
        name: m.name || `Monster ${m.templateId}`,
        level: m.level,
        gfxId: m.gfxId,
      })),
      bonusValue: this.pickableIdToMonsterGroupBonus.get(pickableId) ?? 0,
      x: pageX,
      y: pageY,
      side,
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
    this.pickableIdToMonsterGroupBonus.delete(pickableId);
    this.pickableIdToGroupSpriteIds.delete(pickableId);
    this.pickableIdToPlayerName.delete(pickableId);
    // Sprite teardown while still hovered: drop both source channels
    // and let `recomputeEffectiveHover` synthesise a roll-out.
    let dropped = false;
    if (this.pixelHoverPickableId === pickableId) {
      this.pixelHoverPickableId = undefined;
      dropped = true;
    }
    if (this.cellHoverPickableId === pickableId) {
      this.cellHoverPickableId = undefined;
      dropped = true;
    }
    if (dropped) {
      clearMonsterGroupHover();
      this.recomputeEffectiveHover();
    }
    if (this.selfPickableId === pickableId) {
      // Sprite teardown while still hovered → fire roll-out so the
      // MP overlay drops alongside the avatar instead of lingering on a
      // ghost cell.
      this.onSelfHover?.(false);
      this.selfPickableId = undefined;
    }
  }

  /**
   * Drop the tile-level pickables — every map reload and every zoom
   * rebuild replaces the sprites they point at.
   *
   * Only the tiles: `PickingSystem.clear()` would take the actors with
   * them, and the zoom rebuild runs while actors are on screen and
   * registered. They are unregistered one by one instead.
   */
  clearTiles(): void {
    const pickingSystem = this.deps.pickingSystem();

    for (const pickableId of this.tilePickableIds) {
      pickingSystem?.unregisterObject(pickableId);
    }

    this.tilePickableIds.clear();
    this.pickableIdToGfxId.clear();
    this.pickableIdToCellId.clear();
  }

  /**
   * Drop every actor pickable. Call this whenever the actor renderer is
   * about to be destroyed — on a map change it takes all its sprites with
   * it, and the registrations it leaves behind name sprites that no longer
   * exist.
   */
  clearPlayers(): void {
    for (const playerId of [...this.playerIdToPickableId.keys()]) {
      this.unregisterPlayer(playerId);
    }
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
        const cellId = this.deps.worldActorRenderer()?.getPlayerCell(playerId);
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
    const cellId = this.pickableIdToCellId.get(result.object.id);

    if (gfxId === undefined || cellId === undefined) {
      return;
    }

    const objData = this.deps.interactiveObjects().get(gfxId);

    if (!objData) {
      log.debug("Clicked interactive object with no IO entry:", gfxId);
      return;
    }

    this.showInteractiveContextMenu(objData, cellId, result.x, result.y);
  }

  /**
   * The 1.29 element menu — `DofusBattlefield.onObjectRelease` builds exactly
   * this: the element's name as the header, then one entry per skill in its
   * `IO.d[id].sk` list, greyed out when the action is unavailable.
   *
   * Picking an entry does not fire it immediately. Canonical `useRessource`
   * calls `onCellRelease(mcCell)` first — the player walks to the element and
   * only then does the action go out — which is what `onInteractiveUse`
   * arranges on the game-client side.
   */
  private showInteractiveContextMenu(
    objData: InteractiveObjectData,
    cellId: number,
    screenX: number,
    screenY: number
  ): void {
    const { x, y } = this.pixiToPageCoords(screenX, screenY);
    const options = objData.skills.map((skill) => ({
      label: skill.label,
      disabled: !IMPLEMENTED_INTERACTIVE_SKILLS.has(skill.id),
      onClick: () => this.deps.onInteractiveUse?.(cellId, skill.id),
    }));

    if (options.length === 0) {
      return;
    }

    showContextMenu(objData.name, options, x, y);
  }

  onObjectHover(result: PickResult | null): void {
    // Update the pixel-precise channel only — actual roll-in / roll-
    // out events come out of `recomputeEffectiveHover` which OR's
    // this with the cell-grid channel. Without that OR a tiny pointer
    // movement off the sprite-pixel edge while still inside the cell
    // would fire `onHover(false)` here even though canonical 1.29
    // keeps the fighter hovered as long as the cursor is in the
    // cell diamond — the "hitbox doesn't widen" regression.
    const next = result ? result.object.id : undefined;
    if (next === this.pixelHoverPickableId) {
      return;
    }
    this.pixelHoverPickableId = next;
    this.recomputeEffectiveHover();
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
