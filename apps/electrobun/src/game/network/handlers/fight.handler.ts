import { create } from "@bufbuild/protobuf";

import type { Connection } from "@/game/network/connection";
import type { MessageHandler } from "@/game/network/message-handler";
import { encodeFightPath } from "@/game/network/path-codec";
import {
  type ActionAPChange,
  type ActionDamage,
  type ActionDeath,
  type ActionDirectionChange,
  type ActionMPChange,
  type ActionSpellLaunch,
  type ActionSpritePosition,
  type ActionStateChange,
  type ActionSummon,
  encodeClient,
  type GameAction,
  GameActionRequestSchema,
  type GameCreate,
  type GameEnd,
  type GameJoin,
  GameLeaveRequestSchema,
  type GameMovement,
  type GamePositionStart,
  type GameReady,
  GameSetPositionSchema,
  GameSetReadySchema,
  GameTurnEndSchema,
  type GameTurnFinish,
  type GameTurnList,
  type GameTurnStart,
  type GameZoneData,
  GameZoneData_Operation,
} from "@/game/network/protocol";
import { fightActor } from "@/game/stores/fight-store";

export interface SpellCastPayload {
  casterId: number;
  spellId: number;
  /**
   * SWF/dofasset filename to load — the server's `sorts.sprite`
   * (StarLoco) or GA;300 `visual` (Hetwan). Often differs from
   * `spellId` because many gameplay spells share one gfx file.
   * Defaults to `spellId` when the server hasn't been seeded with
   * the canonical mapping yet.
   */
  visualGfxId: number;
  spellLevel: number;
  targetCellId: number;
  critical: boolean;
  /** Cast pose hint from the server. Empty string = default ("anim1"). */
  animation: string;
}

export interface ZonePayload {
  cellId: number;
  size: number;
  /**
   * Zone tint as 24-bit RGB (0xRRGGBB). Server picks per-spell:
   * traps = orange, glyphs = element-keyed (fire = red, water = blue,
   * etc.). Client uses this directly so the on-map color matches the
   * canonical Dofus 1.29 palette.
   */
  color: number;
  /**
   * Mirrors @dofus/grid AreaKind. Server-supplied so non-circular
   * glyphs/traps render their actual shape. 0 (None) falls back to
   * Circle on the client side.
   */
  areaKind: number;
}

export interface FightEventHandlers {
  onFightCreated?: (payload: GameCreate) => void;
  onFightJoined?: (payload: GameJoin) => void;
  onPositionStart?: (payload: GamePositionStart) => void;
  onFightStart?: () => void;
  onFightEnd?: (payload: GameEnd) => void;
  onTurnStart?: (payload: GameTurnStart) => void;
  onTurnEnd?: (payload: GameTurnFinish) => void;
  onTurnList?: (payload: GameTurnList) => void;
  onReady?: (payload: GameReady) => void;
  onSpellCast?: (payload: SpellCastPayload) => void;
  onAPChange?: (payload: ActionAPChange) => void;
  onMPChange?: (payload: ActionMPChange) => void;
  onDamage?: (payload: ActionDamage) => void;
  onDeath?: (payload: ActionDeath) => void;
  onTeleport?: (payload: ActionSpritePosition) => void;
  onDirectionChange?: (payload: ActionDirectionChange) => void;
  onStateChange?: (payload: ActionStateChange) => void;
  onSummon?: (payload: ActionSummon) => void;
  onMovement?: (payload: GameMovement) => void;
  onZoneAdd?: (payload: ZonePayload) => void;
  onZoneRemove?: (payload: ZonePayload) => void;
}

/**
 * Fight network handler. Bridges in-combat proto messages to the
 * fightActor state machine + renderer callbacks.
 *
 * The new protocol unifies combat + roleplay movement under `gameMovement`
 * (sprite lifecycle) and `gameAction` (one-shot combat events with a
 * typed `action_data` oneof). This handler fans out those events.
 */
export class FightHandler {
  private handlers: FightEventHandlers = {};
  private unsubscribers: (() => void)[] = [];

  constructor(
    messageHandler: MessageHandler,
    private readonly connection: Connection,
    /**
     * Resolves the local player's sprite id (= their character id, as a
     * string). The fight machine needs this to evaluate the `isMyTurn`
     * guard on TURN_START — without it every turn looks like an
     * opponent's turn, blocking move + cast input.
     */
    private readonly getMySpriteId: () => string | null = () => null
  ) {
    this.registerHandlers(messageHandler);
  }

  setHandlers(handlers: FightEventHandlers): void {
    this.handlers = handlers;
  }

  private registerHandlers(mh: MessageHandler): void {
    this.unsubscribers.push(
      mh.on("gameCreate", (payload) => {
        // GameCreate is reused for both exploration entry (state=1)
        // and fight start (state=FightTypePvM=1). The two are
        // indistinguishable here, so we never use it to drive the
        // fight machine — gameJoin is the unambiguous fight-init
        // signal and is always sent alongside a real fight create.
        this.handlers.onFightCreated?.(payload);
      })
    );

    this.unsubscribers.push(
      mh.on("gameJoin", (payload) => {
        const mySpriteId = this.getMySpriteId() ?? undefined;
        if (payload.isSpectator) {
          fightActor.send({ type: "FIGHT_SPECTATE_INIT", payload });
        } else {
          fightActor.send({ type: "FIGHT_INIT", payload, mySpriteId });
        }
        this.handlers.onFightJoined?.(payload);
      })
    );

    this.unsubscribers.push(
      mh.on("gamePositionStart", (payload) => {
        this.handlers.onPositionStart?.(payload);
      })
    );

    this.unsubscribers.push(
      mh.on("gameStartToPlay", () => {
        fightActor.send({ type: "FIGHT_START" });
        this.handlers.onFightStart?.();
      })
    );

    this.unsubscribers.push(
      mh.on("gameEnd", (payload) => {
        fightActor.send({ type: "FIGHT_END", payload });
        this.handlers.onFightEnd?.(payload);
      })
    );

    this.unsubscribers.push(
      mh.on("gameTurnStart", (payload) => {
        fightActor.send({ type: "TURN_START", payload });
        this.handlers.onTurnStart?.(payload);
      })
    );

    this.unsubscribers.push(
      mh.on("gameTurnFinish", (payload) => {
        fightActor.send({ type: "TURN_END", payload });
        this.handlers.onTurnEnd?.(payload);
      })
    );

    this.unsubscribers.push(
      mh.on("gameTurnList", (payload) => {
        fightActor.send({
          type: "TIMELINE_UPDATE",
          timeline: payload.spriteIds,
        });
        this.handlers.onTurnList?.(payload);
      })
    );

    this.unsubscribers.push(
      mh.on("gameTurnMiddle", (payload) => {
        // Per-turn snapshot: every fighter's current LP/AP/MP/cell.
        // Project the full roster into the fight store so the HUD
        // (timeline, fighter panels, hover preview) reflects server
        // truth; mirror our own stats into the top-level ap/mp for
        // the gauges + reachable-range calc.
        const mySpriteId = this.getMySpriteId();
        for (const entry of payload.entries) {
          fightActor.send({
            type: "FIGHTER_UPDATE",
            spriteId: entry.spriteId,
            patch: {
              hp: entry.lp,
              maxHp: entry.lpMax,
              ap: entry.ap,
              mp: entry.mp,
              cell: entry.cellNum,
              // Only LATCH dead to true via gameTurnMiddle — never
              // un-set it. The death `FIGHTER_UPDATE` from
              // `routeAction("death")` is authoritative for the
              // dead transition; gameTurnMiddle's `isDead` field is
              // sometimes false on the wire even for corpses (the
              // server tears them down asynchronously), and
              // overwriting back to false would let dead-monster
              // cells re-block pathfinding/LoS for the next hover.
              ...(entry.isDead ? { dead: true } : {}),
            },
          });
        }
        if (!mySpriteId) {
          return;
        }
        const mine = payload.entries.find((e) => e.spriteId === mySpriteId);
        if (!mine) {
          return;
        }
        // maxAp / maxMp aren't on the wire — the fighters map anchors
        // them on first positive reading. Top-level ap/mp mirror only
        // the player's current values for legacy consumers.
        const snap = fightActor.getSnapshot();
        const mine2 = snap.context.fighters.get(mySpriteId);
        fightActor.send({
          type: "STATS_UPDATE",
          ap: mine.ap,
          mp: mine.mp,
          maxAp: mine2?.maxAp && mine2.maxAp > 0 ? mine2.maxAp : mine.ap,
          maxMp: mine2?.maxMp && mine2.maxMp > 0 ? mine2.maxMp : mine.mp,
        });
      })
    );

    this.unsubscribers.push(
      mh.on("gameReady", (payload) => {
        this.handlers.onReady?.(payload);
      })
    );

    this.unsubscribers.push(
      mh.on("gameMovement", (payload) => {
        // During placement / combat, each sprite entry is a fighter —
        // the server fans out ADD on placement, UPDATE on summon, and
        // REMOVE on despawn. Keep the fighters map in sync so the HUD
        // has name/level/team/hp without needing a separate roster
        // frame. Outside a fight the state machine ignores these
        // events (gated on the placement / fighting / spectating
        // substates), so this is cheap in the roleplay path.
        for (const entry of payload.entries) {
          if (entry.operation === 2 /* REMOVE */) {
            fightActor.send({
              type: "FIGHTER_REMOVE",
              spriteId: entry.spriteId,
            });
            continue;
          }
          // Only push sprites the server actually placed in a team —
          // roleplay players have team=0 by default, so we filter
          // using the per-entry fight fields (lpMax > 0 means the
          // server prepared it as a fighter).
          if (entry.lpMax <= 0 && entry.lp <= 0) {
            continue;
          }
          // Monster-group entries carry their colours on the leader
          // member, not on `entry.colors` (the top-level CharacterColors
          // is for player sprites). Mirror what `encodeLook` does in
          // map.handler.ts so player and monster fighters both end up
          // in the store with the right tint.
          const isMonsterGroup =
            entry.spriteType === 3 /* SPRITE_TYPE_MONSTER_GROUP */ &&
            entry.monsters.length > 0;
          const leader = isMonsterGroup ? entry.monsters[0] : null;
          const c1 = leader?.color1 ?? entry.colors?.color1 ?? -1;
          const c2 = leader?.color2 ?? entry.colors?.color2 ?? -1;
          const c3 = leader?.color3 ?? entry.colors?.color3 ?? -1;
          fightActor.send({
            type: "FIGHTER_UPSERT",
            fighter: {
              spriteId: entry.spriteId,
              name: entry.name || `Actor ${entry.spriteId}`,
              level: entry.level,
              team: entry.team === 1 ? 1 : 0,
              cell: entry.cellId,
              hp: entry.lp,
              maxHp: entry.lpMax,
              ap: entry.ap,
              maxAp: entry.ap,
              mp: entry.mp,
              maxMp: entry.mp,
              gfxId: entry.gfxId,
              dead: false,
              color1: c1,
              color2: c2,
              color3: c3,
              ...(entry.isSummoned ? { summonedBy: entry.spriteId } : {}),
            },
          });
        }
        this.handlers.onMovement?.(payload);
      })
    );

    this.unsubscribers.push(
      mh.on("gameAction", (payload) => this.routeAction(payload))
    );

    this.unsubscribers.push(
      mh.on("gameZoneData", (payload: GameZoneData) => {
        const zone: ZonePayload = {
          cellId: payload.cellId,
          size: payload.size,
          color: payload.color,
          areaKind: payload.areaKind,
        };
        if (payload.operation === GameZoneData_Operation.ADD) {
          this.handlers.onZoneAdd?.(zone);
        } else if (payload.operation === GameZoneData_Operation.REMOVE) {
          this.handlers.onZoneRemove?.(zone);
        }
      })
    );
  }

  private routeAction(action: GameAction): void {
    const data = action.actionData;

    switch (data.case) {
      case "spellLaunch":
        this.handlers.onSpellCast?.(spellLaunchToPayload(action, data.value));
        break;
      case "criticalHit":
        this.handlers.onSpellCast?.({
          casterId: Number(action.spriteId) || 0,
          spellId: data.value.spellId,
          visualGfxId: data.value.spellId,
          spellLevel: 0,
          targetCellId: 0,
          critical: true,
          animation: "anim1",
        });
        break;
      case "apChange": {
        this.handlers.onAPChange?.(data.value);
        // Delta is a signed change (negative = AP spent). Apply
        // relative to current AP, not overwrite, so consecutive casts
        // stack. Only mirror when the event targets the local player.
        const my = this.getMySpriteId();
        if (my && data.value.spriteId === my) {
          const snap = fightActor.getSnapshot();
          fightActor.send({
            type: "STATS_UPDATE",
            ap: snap.context.ap + data.value.delta,
          });
        }
        break;
      }
      case "mpChange": {
        this.handlers.onMPChange?.(data.value);
        const my = this.getMySpriteId();
        if (my && data.value.spriteId === my) {
          const snap = fightActor.getSnapshot();
          fightActor.send({
            type: "STATS_UPDATE",
            mp: snap.context.mp + data.value.delta,
          });
        }
        break;
      }
      case "damage": {
        this.handlers.onDamage?.(data.value);
        // Mirror HP into the fighters map so the timeline bar and
        // hover tooltips reflect every hit without waiting for the
        // next gameTurnMiddle snapshot. Amount > 0 = damage, < 0 = heal.
        fightActor.send({
          type: "FIGHTER_UPDATE",
          spriteId: data.value.spriteId,
          patch: this.hpPatch(data.value.spriteId, -data.value.amount),
        });
        break;
      }
      case "death": {
        this.handlers.onDeath?.(data.value);
        fightActor.send({
          type: "FIGHTER_UPDATE",
          spriteId: data.value.spriteId,
          patch: { dead: true, hp: 0 },
        });
        break;
      }
      case "spritePosition": {
        // 4 = ACTION_SPRITE_POSITION; server uses it for teleports
        // (Boussole/Stabilisation/etc. move fighters without a walk
        // animation). Update the fighter's cell immediately; the
        // renderer snaps the sprite via onTeleport.
        this.handlers.onTeleport?.(data.value);
        fightActor.send({
          type: "FIGHTER_UPDATE",
          spriteId: data.value.spriteId,
          patch: { cell: data.value.cellId },
        });
        break;
      }
      case "directionChange":
        this.handlers.onDirectionChange?.(data.value);
        break;
      case "stateChange":
        // Buff/debuff state toggles. Propagated to the renderer for
        // status-icon badging; fighter map doesn't track states yet
        // (step 6 + will add `states: StateEntry[]`).
        this.handlers.onStateChange?.(data.value);
        break;
      case "summon": {
        this.handlers.onSummon?.(data.value);
        const sd = data.value.spriteData;
        if (sd) {
          fightActor.send({
            type: "FIGHTER_UPSERT",
            fighter: {
              spriteId: sd.spriteId,
              name: sd.name || `Summon ${sd.spriteId}`,
              level: sd.level,
              team: sd.team === 1 ? 1 : 0,
              cell: data.value.cellId,
              hp: sd.lp,
              maxHp: sd.lpMax,
              ap: sd.ap,
              maxAp: sd.ap,
              mp: sd.mp,
              maxMp: sd.mp,
              gfxId: sd.gfxId,
              dead: false,
              // Summon spriteData doesn't carry colours on the wire
              // (the server populates the gfx id; visual tint is left
              // to the client). Default to -1 = "use gfx defaults".
              color1: -1,
              color2: -1,
              color3: -1,
              summonedBy: action.spriteId,
            },
          });
        }
        break;
      }
      case "movement": {
        // Fight movement — update the fighter's cell in the store so
        // subsequent pathfinding calculations use the correct position.
        const path = data.value.pathCells;
        const endCell = path.length > 0 ? path[path.length - 1] : undefined;
        if (endCell !== undefined) {
          fightActor.send({
            type: "FIGHTER_UPDATE",
            spriteId: action.spriteId,
            patch: { cell: endCell },
          });
        }
        break;
      }
      default:
        break;
    }
  }

  /**
   * Compute a HP patch from a current fighter snapshot: the wire delta
   * is applied to the latest known HP, floored at 0 and capped at maxHp.
   */
  private hpPatch(spriteId: string, delta: number): { hp: number } {
    const existing = fightActor.getSnapshot().context.fighters.get(spriteId);
    const current = existing?.hp ?? 0;
    const max = existing?.maxHp ?? Number.POSITIVE_INFINITY;
    return { hp: Math.max(0, Math.min(max, current + delta)) };
  }

  // ── Outbound commands (client → server) ───────────────────────────

  /** Accept an incoming fight challenge. */
  acceptChallenge(): void {
    this.connection.send(
      encodeClient(
        "gameAction",
        create(GameActionRequestSchema, { actionType: 901, params: "" })
      )
    );
  }

  /** Refuse an incoming fight challenge. */
  refuseChallenge(): void {
    this.connection.send(
      encodeClient(
        "gameAction",
        create(GameActionRequestSchema, { actionType: 902, params: "" })
      )
    );
  }

  /** Mark ready during placement. */
  setReady(ready: boolean): void {
    this.connection.send(
      encodeClient("gameSetReady", create(GameSetReadySchema, { ready }))
    );
  }

  /** Pass the current turn. */
  passTurn(): void {
    this.connection.send(
      encodeClient("gameTurnEnd", create(GameTurnEndSchema, {}))
    );
  }

  /** Forfeit the fight. */
  forfeit(): void {
    this.connection.send(
      encodeClient("gameLeave", create(GameLeaveRequestSchema, {}))
    );
  }

  /** Set placement cell during preparation. */
  setPlacement(cellId: number): void {
    this.connection.send(
      encodeClient(
        "gameSetPosition",
        create(GameSetPositionSchema, { cellNum: cellId })
      )
    );
  }

  /**
   * Send a movement request during a fight. Path includes the starting
   * cell as path[0]; the codec emits steps for path[1..]. Action verb
   * 1 = ACTION_MOVEMENT.
   */
  sendMove(path: number[], mapWidth: number): void {
    const params = encodeFightPath(path, mapWidth);
    if (params === "") {
      return;
    }
    this.connection.send(
      encodeClient(
        "gameAction",
        create(GameActionRequestSchema, { actionType: 1, params })
      )
    );
  }

  /**
   * Send a spell-cast request. Server expects params formatted as
   * "<spellId>;<targetCell>;<level>". Action verb 300 = ACTION_SPELL_LAUNCH.
   */
  sendCast(spellId: number, targetCellId: number, level = 1): void {
    const params = `${spellId};${targetCellId};${level}`;
    this.connection.send(
      encodeClient(
        "gameAction",
        create(GameActionRequestSchema, { actionType: 300, params })
      )
    );
  }

  destroy(): void {
    for (const u of this.unsubscribers) u();
    this.unsubscribers = [];
    this.handlers = {};
  }
}

function spellLaunchToPayload(
  action: GameAction,
  data: ActionSpellLaunch
): SpellCastPayload {
  // param3 carries the visual gfx id (Hetwan's GA;300 `visual` field).
  // 0 = "no spell-specific visual" (StarLoco's sorts.sprite=0 — common
  // for glyphs / buffs / area effects where the canonical client just
  // plays the cast pose + shows the server-driven GameZoneData overlay).
  // Trust the server: do NOT fall back to spellId, because /spells/<id>.dofasset
  // probably doesn't exist for those spells and the loader will trip on
  // the dev server's HTML SPA fallback.
  const visualGfxId = data.param3;
  return {
    casterId: Number(action.spriteId) || 0,
    spellId: data.spellId,
    visualGfxId,
    spellLevel: 1,
    targetCellId: data.cellId,
    critical: false,
    // Server-supplied cast pose; fall back to "anim1" so the caster
    // sprite always has a CAST animation to play even on legacy frames.
    animation: data.animation || "anim1",
  };
}
