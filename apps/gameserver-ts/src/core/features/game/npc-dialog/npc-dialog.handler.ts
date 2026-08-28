import type { MessageInitShape } from "@bufbuild/protobuf";
import type { HandlerContext } from "@shared/gateway-adapter/ws-router";
import { create } from "@bufbuild/protobuf";
import {
  type DialogCreateRequest,
  DialogCreateRequestSchema,
  DialogCreateSchema,
  type DialogLeaveRequest,
  DialogLeaveRequestSchema,
  DialogLeaveSchema,
  DialogQuestionSchema,
  type DialogResponseRequest,
  DialogResponseRequestSchema,
} from "@dofus/proto/chat_pb";
import { DofusMessageSchema } from "@dofus/proto/server_messages_pb";
import { FightRegistryService } from "@modules/fight/registry/fight.registry";
import { MapNpcService } from "@modules/npcs/map-npc.service";
import { NpcDialogService } from "@modules/npcs/npc-dialog.service";
import { NpcDialogSessionService } from "@modules/npcs/npc-dialog.session";
import { PlayerPresenceService } from "@modules/player-presence/player-presence.service";
import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";
import { MessageHandler } from "@shared/gateway-adapter/message-handler.decorator";
import { SessionRegistry } from "@shared/gateway-adapter/session-registry";

/** The three dialog frames this handler is allowed to put on the wire. */
type DialogPayload = Extract<
  NonNullable<MessageInitShape<typeof DofusMessageSchema>["payload"]>,
  { case: "dialogCreate" | "dialogQuestion" | "dialogLeave" }
>;

/**
 * DC / DR / DV — the "Parler" half of an NPC.
 *
 * The three belong in one file because they are one conversation: DC opens it
 * and pins the NPC, DR advances it, DV closes it, and every one of them is
 * meaningless without the state the other two maintain
 * (`NpcDialogSessionService`).
 *
 * What travels is ids, never text. A question id is its own key into the
 * client's `dialog` lang bundle (`D.q[id]`, `D.a[id]`) — canonical
 * `Question.initialize` resolves it client-side — so the server never loads a
 * line of dialogue.
 */
@Injectable()
export class NpcDialogHandler {
  private readonly logger = new Logger(NpcDialogHandler.name);

  constructor(
    private readonly sessions: SessionRegistry,
    private readonly presence: PlayerPresenceService,
    private readonly npcs: MapNpcService,
    private readonly fights: FightRegistryService,
    private readonly graph: NpcDialogService,
    private readonly open: NpcDialogSessionService,
    private readonly frames: GatewayFrameService
  ) {}

  /**
   * DC — the player picked "Parler" in the NPC's action bubble.
   *
   * The sprite id is resolved *against the player's own map*. That is the
   * whole access check: a client can name any id it likes, and only the NPCs
   * on the map it currently stands on will resolve.
   */
  @MessageHandler(DialogCreateRequestSchema)
  async create(ctx: HandlerContext, msg: DialogCreateRequest): Promise<void> {
    const placed = this.placedPlayer(ctx.sessionId);
    if (!placed) {
      return;
    }

    if (this.fights.isInFight(ctx.sessionId)) {
      return;
    }

    const npc = this.npcs.onMapById(placed.mapId, Number(msg.npcSpriteId));

    if (!npc) {
      this.logger.warn(
        `dialog: sprite ${msg.npcSpriteId} is not an NPC on map ` +
          `${placed.mapId} session=${ctx.sessionId}`
      );
      this.send(ctx.sessionId, {
        case: "dialogCreate",
        value: create(DialogCreateSchema, { success: false }),
      });
      return;
    }

    if (npc.initialQuestion <= 0) {
      // The bubble only offers "Parler" when the lang bundle lists action 3,
      // and 74 NPCs advertise it with no tree behind it in the dump. Refusing
      // is what keeps the window from opening blank.
      this.send(ctx.sessionId, {
        case: "dialogCreate",
        value: create(DialogCreateSchema, { success: false }),
      });
      return;
    }

    this.open.open(ctx.sessionId, {
      npcSpriteId: npc.id,
      templateId: npc.templateId,
      mapId: placed.mapId,
      questionId: npc.initialQuestion,
    });

    this.send(ctx.sessionId, {
      case: "dialogCreate",
      value: create(DialogCreateSchema, {
        success: true,
        npcId: BigInt(npc.templateId),
        gfxId: npc.gfx,
        customArtwork: npc.customArtwork,
        color1: npc.color1,
        color2: npc.color2,
        color3: npc.color3,
        name: npc.name,
      }),
    });

    await this.sendQuestion(ctx.sessionId, npc.initialQuestion);
  }

  /**
   * DR — the player picked an answer.
   *
   * Both the question and the answer are checked against the dialog that is
   * actually open. Without that, a client could post any `(question, answer)`
   * pair and walk the tree from the outside — which matters the moment an
   * answer does something other than navigate.
   */
  @MessageHandler(DialogResponseRequestSchema)
  async respond(
    ctx: HandlerContext,
    msg: DialogResponseRequest
  ): Promise<void> {
    const open = this.open.get(ctx.sessionId);

    if (!open) {
      return;
    }

    if (open.questionId !== msg.questionId) {
      this.logger.warn(
        `dialog: answer for question ${msg.questionId} while on ` +
          `${open.questionId} session=${ctx.sessionId}`
      );
      return;
    }

    const question = await this.graph.question(open.questionId);

    if (!question?.responseIds.includes(msg.responseId)) {
      this.logger.warn(
        `dialog: answer ${msg.responseId} does not belong to question ` +
          `${open.questionId} session=${ctx.sessionId}`
      );
      return;
    }

    const outcome = await this.graph.outcome(msg.responseId);

    if (outcome.kind === "blocked") {
      // The client greys these, so reaching here means a client that did not.
      // Ignore rather than close: closing would look like the action ran.
      return;
    }

    if (outcome.kind === "end") {
      this.leaveSession(ctx.sessionId);
      return;
    }

    this.open.advance(ctx.sessionId, outcome.nextQuestion);
    await this.sendQuestion(ctx.sessionId, outcome.nextQuestion);
  }

  /** DV — the player closed the window, or an answer ended the conversation. */
  @MessageHandler(DialogLeaveRequestSchema)
  leave(ctx: HandlerContext, _msg: DialogLeaveRequest): void {
    this.leaveSession(ctx.sessionId);
  }

  /**
   * A dropped socket leaves no one to send DV to, but the entry would keep the
   * NPC marked busy and pin it in place forever, so it still has to go.
   */
  @OnEvent("session.closed")
  onSessionClosed({ session }: { session: { sessionId: string } }): void {
    this.open.close(session.sessionId);
  }

  private async sendQuestion(
    sessionId: string,
    questionId: number
  ): Promise<void> {
    const question = await this.graph.question(questionId);

    if (!question) {
      // 17 of the reachable questions have no row: the dump branches to ids it
      // never defines. Ending is the only honest thing left to do.
      this.logger.warn(`dialog: no such question ${questionId}`);
      this.leaveSession(sessionId);
      return;
    }

    this.send(sessionId, {
      case: "dialogQuestion",
      value: create(DialogQuestionSchema, {
        questionId: question.id,
        params: question.parameters,
        responseIds: question.responseIds,
        unavailableResponseIds: await this.graph.unavailable(
          question.responseIds
        ),
      }),
    });
  }

  private leaveSession(sessionId: string): void {
    if (this.open.close(sessionId)) {
      this.send(sessionId, {
        case: "dialogLeave",
        value: create(DialogLeaveSchema, {}),
      });
    }
  }

  private placedPlayer(sessionId: string): { mapId: number } | undefined {
    const session = this.sessions.get(sessionId);
    if (!session?.characterId) {
      return undefined;
    }
    return this.presence.getByCharacter(session.characterId);
  }

  private send(sessionId: string, payload: DialogPayload): void {
    this.frames.broadcast([sessionId], create(DofusMessageSchema, { payload }));
  }
}
