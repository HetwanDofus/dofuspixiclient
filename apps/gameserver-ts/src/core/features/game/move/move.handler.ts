import type { HandlerContext } from "@shared/gateway-adapter/ws-router";
import { create } from "@bufbuild/protobuf";
import {
  ActionMovementSchema,
  type GameActionRequest,
  GameActionRequestSchema,
  GameActionSchema,
  GameActionsStartSchema,
  GameActionType,
} from "@dofus/proto/game_pb";
import { DofusMessageSchema } from "@dofus/proto/server_messages_pb";
import { ExchangeService } from "@modules/exchange/exchange.service";
import {
  type CachedMap,
  MapCacheService,
} from "@modules/maps/maps.cache.service";
import {
  decodePathParams,
  MalformedPathError,
} from "@modules/maps/maps.path-codec";
import {
  InvalidPathError,
  type ValidatedPath,
  validatePath,
} from "@modules/maps/maps.validate-path";
import { PendingMovesService } from "@modules/player-presence/player-presence.pending-moves.service";
import { PlayerPresenceService } from "@modules/player-presence/player-presence.service";
import { Injectable, Logger } from "@nestjs/common";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";
import { MessageHandler } from "@shared/gateway-adapter/message-handler.decorator";
import { SessionRegistry } from "@shared/gateway-adapter/session-registry";

// Validates the client's path (adjacency + walkability) and opens an
// in-flight entry keyed by session. The committed cell isn't touched until
// GameActionAck arrives — see MoveAckHandler.

@Injectable()
export class MoveHandler {
  private readonly logger = new Logger(MoveHandler.name);

  constructor(
    private readonly mapCache: MapCacheService,
    private readonly presence: PlayerPresenceService,
    private readonly pending: PendingMovesService,
    private readonly exchange: ExchangeService,
    private readonly sessions: SessionRegistry,
    private readonly frames: GatewayFrameService
  ) {}

  @MessageHandler(GameActionRequestSchema)
  async handle(ctx: HandlerContext, msg: GameActionRequest): Promise<void> {
    if (msg.actionType !== GameActionType.ACTION_MOVEMENT) {
      return;
    }

    const session = this.sessions.get(ctx.sessionId);

    if (!session?.characterId) {
      return;
    }

    // A trade pins both players where they stand until it ends. The
    // canonical client will not even send this while the Exchange
    // window is up, but ours has to be told, and the same-map rule the
    // trade enforces would be meaningless if either side could walk
    // off mid-deal. A bank or a chest does not block — see
    // `ExchangeService.blocksMovement`.
    if (this.exchange.blocksMovement(ctx.sessionId)) {
      return;
    }

    const placed = this.presence.getByCharacter(session.characterId);

    if (!placed) {
      this.logger.warn(`move: no presence session=${ctx.sessionId}`);
      return;
    }

    const map = await this.mapCache.load(placed.mapId);

    if (!map) {
      this.logger.warn(`move: map not cached id=${placed.mapId}`);
      return;
    }

    const rawParams = firstField(msg.params);
    const validated = this.tryValidate(rawParams, placed.cellId, map, ctx);

    if (!validated) {
      return;
    }

    const actionId = this.pending.allocateActionId();

    this.pending.set({
      sessionId: ctx.sessionId,
      characterId: session.characterId,
      actionId,
      mapId: placed.mapId,
      endCell: validated.endCell,
      endDirection: validated.endDirection,
      // Kept so an interruption can be checked against the path that
      // was actually authorised — see `MoveAckHandler`.
      steps: validated.steps,
    });

    const targets = this.presence.sessionsOnMap(placed.mapId);

    this.frames.broadcast(
      targets,
      create(DofusMessageSchema, {
        payload: {
          case: "gameActionsStart",
          value: create(GameActionsStartSchema, {
            spriteId: session.characterId,
          }),
        },
      })
    );

    this.frames.broadcast(
      targets,
      create(DofusMessageSchema, {
        payload: {
          case: "gameAction",
          value: create(GameActionSchema, {
            sequenceId: actionId,
            actionType: GameActionType.ACTION_MOVEMENT,
            spriteId: session.characterId,
            rawParams,
            actionData: {
              case: "movement",
              value: create(ActionMovementSchema, {
                pathCells: [placed.cellId, ...validated.cells],
              }),
            },
          }),
        },
      })
    );
  }

  private tryValidate(
    rawParams: string,
    startCell: number,
    map: CachedMap,
    ctx: HandlerContext
  ): ValidatedPath | undefined {
    try {
      return validatePath(
        startCell,
        decodePathParams(rawParams, map.width),
        map
      );
    } catch (err) {
      if (
        err instanceof MalformedPathError ||
        err instanceof InvalidPathError
      ) {
        this.logger.warn(`move: ${err.message} session=${ctx.sessionId}`);
        return undefined;
      }
      throw err;
    }
  }
}

function firstField(params: string): string {
  const idx = params.indexOf(";");

  return idx < 0 ? params : params.slice(0, idx);
}
