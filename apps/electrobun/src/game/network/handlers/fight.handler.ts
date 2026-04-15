import type { Connection } from "@/game/network/connection";
import type { MessageHandler } from "@/game/network/message-handler";
import { create } from "@bufbuild/protobuf";

import {
  encodeClient,
  GameActionRequestSchema,
  GameLeaveRequestSchema,
  GameSetReadySchema,
  GameSetPositionSchema,
  GameTurnEndSchema,
  type ActionAPChange,
  type ActionMPChange,
  type ActionSpellLaunch,
  type GameAction,
  type GameCreate,
  type GameEnd,
  type GameJoin,
  type GameMovement,
  type GamePositionStart,
  type GameReady,
  type GameTurnFinish,
  type GameTurnList,
  type GameTurnStart,
} from "@/game/network/protocol";
import { fightActor } from "@/game/stores/fight-store";

export interface SpellCastPayload {
  casterId: number;
  spellId: number;
  spellLevel: number;
  targetCellId: number;
  critical: boolean;
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
  onMovement?: (payload: GameMovement) => void;
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
    private readonly connection: Connection
  ) {
    this.registerHandlers(messageHandler);
  }

  setHandlers(handlers: FightEventHandlers): void {
    this.handlers = handlers;
  }

  private registerHandlers(mh: MessageHandler): void {
    this.unsubscribers.push(
      mh.on("gameCreate", (payload) => {
        fightActor.send({ type: "FIGHT_INIT", payload });
        this.handlers.onFightCreated?.(payload);
      })
    );

    this.unsubscribers.push(
      mh.on("gameJoin", (payload) => {
        if (payload.isSpectator) {
          fightActor.send({ type: "FIGHT_SPECTATE_INIT", payload });
        } else {
          fightActor.send({ type: "FIGHT_INIT", payload });
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
      mh.on("gameReady", (payload) => {
        this.handlers.onReady?.(payload);
      })
    );

    this.unsubscribers.push(
      mh.on("gameMovement", (payload) => {
        this.handlers.onMovement?.(payload);
      })
    );

    this.unsubscribers.push(
      mh.on("gameAction", (payload) => this.routeAction(payload))
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
          spellLevel: 0,
          targetCellId: 0,
          critical: true,
        });
        break;
      case "apChange":
        this.handlers.onAPChange?.(data.value);
        fightActor.send({
          type: "STATS_UPDATE",
          ap: data.value.delta,
        });
        break;
      case "mpChange":
        this.handlers.onMPChange?.(data.value);
        fightActor.send({
          type: "STATS_UPDATE",
          mp: data.value.delta,
        });
        break;
      default:
        // Other actions (damage, death, state changes, etc.) are consumed by
        // their dedicated store/handler wires as they come online.
        break;
    }
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
  return {
    casterId: Number(action.spriteId) || 0,
    spellId: data.spellId,
    spellLevel: 1,
    targetCellId: data.cellId,
    critical: false,
  };
}

