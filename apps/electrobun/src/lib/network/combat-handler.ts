import { ServerMessageType, encodeMessage, ClientMessageType } from './protocol';
import type { MessageHandler } from './message-handler';
import type { Connection } from './connection';
import type {
  CombatInitPayload,
  CombatFighterPayload,
  CombatLeavePayload,
  CombatStartPayload,
  CombatEndPayload,
  CombatTurnStartPayload,
  CombatTurnEndPayload,
  CombatEffectPayload,
  CombatMovementPayload,
  CombatSpellPayload,
  CombatPlacementPayload,
  CombatTimelinePayload,
  CombatStatsPayload,
  CombatReadyPayload,
  CombatChallengePayload,
  CombatChallengeRequestPayload,
  CombatChallengeResponsePayload,
  CombatReadyRequestPayload,
  CombatMoveRequestPayload,
  CombatCastRequestPayload,
  CombatPlacementRequestPayload,
  CombatSpectateRequestPayload,
} from './combat-payloads';

/**
 * Combat event callbacks.
 */
export interface CombatEventHandlers {
  onCombatInit?: (payload: CombatInitPayload) => void;
  onFighterJoin?: (payload: CombatFighterPayload) => void;
  onFighterLeave?: (payload: CombatLeavePayload) => void;
  onCombatStart?: (payload: CombatStartPayload) => void;
  onCombatEnd?: (payload: CombatEndPayload) => void;
  onTurnStart?: (payload: CombatTurnStartPayload) => void;
  onTurnEnd?: (payload: CombatTurnEndPayload) => void;
  onEffect?: (payload: CombatEffectPayload) => void;
  onMovement?: (payload: CombatMovementPayload) => void;
  onSpellCast?: (payload: CombatSpellPayload) => void;
  onPlacement?: (payload: CombatPlacementPayload) => void;
  onTimeline?: (payload: CombatTimelinePayload) => void;
  onStats?: (payload: CombatStatsPayload) => void;
  onReady?: (payload: CombatReadyPayload) => void;
  onChallenge?: (payload: CombatChallengePayload) => void;
}

/**
 * Combat message handler.
 * Bridges network messages with game systems.
 */
export class CombatHandler {
  private connection: Connection;
  private handlers: CombatEventHandlers = {};
  private unsubscribers: (() => void)[] = [];

  constructor(messageHandler: MessageHandler, connection: Connection) {
    this.connection = connection;
    this.registerHandlers(messageHandler);
  }

  /**
   * Set event handlers.
   */
  setHandlers(handlers: CombatEventHandlers): void {
    this.handlers = handlers;
  }

  /**
   * Register message handlers.
   */
  private registerHandlers(messageHandler: MessageHandler): void {
    this.unsubscribers.push(
      messageHandler.on(ServerMessageType.COMBAT_INIT, (payload: CombatInitPayload) => {
        this.handlers.onCombatInit?.(payload);
      })
    );

    this.unsubscribers.push(
      messageHandler.on(ServerMessageType.COMBAT_JOIN, (payload: CombatFighterPayload) => {
        this.handlers.onFighterJoin?.(payload);
      })
    );

    this.unsubscribers.push(
      messageHandler.on(ServerMessageType.COMBAT_LEAVE, (payload: CombatLeavePayload) => {
        this.handlers.onFighterLeave?.(payload);
      })
    );

    this.unsubscribers.push(
      messageHandler.on(ServerMessageType.COMBAT_START, (payload: CombatStartPayload) => {
        this.handlers.onCombatStart?.(payload);
      })
    );

    this.unsubscribers.push(
      messageHandler.on(ServerMessageType.COMBAT_END, (payload: CombatEndPayload) => {
        this.handlers.onCombatEnd?.(payload);
      })
    );

    this.unsubscribers.push(
      messageHandler.on(ServerMessageType.COMBAT_TURN_START, (payload: CombatTurnStartPayload) => {
        this.handlers.onTurnStart?.(payload);
      })
    );

    this.unsubscribers.push(
      messageHandler.on(ServerMessageType.COMBAT_TURN_END, (payload: CombatTurnEndPayload) => {
        this.handlers.onTurnEnd?.(payload);
      })
    );

    this.unsubscribers.push(
      messageHandler.on(ServerMessageType.COMBAT_EFFECT, (payload: CombatEffectPayload) => {
        this.handlers.onEffect?.(payload);
      })
    );

    this.unsubscribers.push(
      messageHandler.on(ServerMessageType.COMBAT_MOVEMENT, (payload: CombatMovementPayload) => {
        this.handlers.onMovement?.(payload);
      })
    );

    this.unsubscribers.push(
      messageHandler.on(ServerMessageType.COMBAT_SPELL, (payload: CombatSpellPayload) => {
        this.handlers.onSpellCast?.(payload);
      })
    );

    this.unsubscribers.push(
      messageHandler.on(ServerMessageType.COMBAT_PLACEMENT, (payload: CombatPlacementPayload) => {
        this.handlers.onPlacement?.(payload);
      })
    );

    this.unsubscribers.push(
      messageHandler.on(ServerMessageType.COMBAT_TIMELINE, (payload: CombatTimelinePayload) => {
        this.handlers.onTimeline?.(payload);
      })
    );

    this.unsubscribers.push(
      messageHandler.on(ServerMessageType.COMBAT_STATS, (payload: CombatStatsPayload) => {
        this.handlers.onStats?.(payload);
      })
    );

    this.unsubscribers.push(
      messageHandler.on(ServerMessageType.COMBAT_READY, (payload: CombatReadyPayload) => {
        this.handlers.onReady?.(payload);
      })
    );

    this.unsubscribers.push(
      messageHandler.on(ServerMessageType.COMBAT_CHALLENGE, (payload: CombatChallengePayload) => {
        this.handlers.onChallenge?.(payload);
      })
    );
  }

  // ============================================================================
  // Client Actions
  // ============================================================================

  /**
   * Challenge another player.
   */
  challenge(targetId: number): void {
    const payload: CombatChallengeRequestPayload = { targetId };
    this.connection.send(encodeMessage(ClientMessageType.COMBAT_CHALLENGE, payload));
  }

  /**
   * Accept a challenge.
   */
  acceptChallenge(challengerId: number): void {
    const payload: CombatChallengeResponsePayload = { challengerId, accept: true };
    this.connection.send(encodeMessage(ClientMessageType.COMBAT_ACCEPT, payload));
  }

  /**
   * Refuse a challenge.
   */
  refuseChallenge(challengerId: number): void {
    const payload: CombatChallengeResponsePayload = { challengerId, accept: false };
    this.connection.send(encodeMessage(ClientMessageType.COMBAT_REFUSE, payload));
  }

  /**
   * Set ready status during placement phase.
   */
  setReady(ready: boolean): void {
    const payload: CombatReadyRequestPayload = { ready };
    this.connection.send(encodeMessage(ClientMessageType.COMBAT_READY, payload));
  }

  /**
   * Move fighter during combat.
   */
  move(path: number[]): void {
    const payload: CombatMoveRequestPayload = { path };
    this.connection.send(encodeMessage(ClientMessageType.COMBAT_MOVE, payload));
  }

  /**
   * Cast a spell.
   */
  castSpell(spellId: number, targetCellId: number): void {
    const payload: CombatCastRequestPayload = { spellId, targetCellId };
    this.connection.send(encodeMessage(ClientMessageType.COMBAT_CAST, payload));
  }

  /**
   * Pass the current turn.
   */
  passTurn(): void {
    this.connection.send(encodeMessage(ClientMessageType.COMBAT_PASS, {}));
  }

  /**
   * Forfeit the combat.
   */
  forfeit(): void {
    this.connection.send(encodeMessage(ClientMessageType.COMBAT_FORFEIT, {}));
  }

  /**
   * Set placement position during preparation phase.
   */
  setPlacement(cellId: number): void {
    const payload: CombatPlacementRequestPayload = { cellId };
    this.connection.send(encodeMessage(ClientMessageType.COMBAT_PLACEMENT, payload));
  }

  /**
   * Request to spectate a fight.
   */
  spectate(fightId: number): void {
    const payload: CombatSpectateRequestPayload = { fightId };
    this.connection.send(encodeMessage(ClientMessageType.COMBAT_SPECTATE, payload));
  }

  /**
   * Cleanup handler subscriptions.
   */
  destroy(): void {
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }

    this.unsubscribers = [];
    this.handlers = {};
  }
}
