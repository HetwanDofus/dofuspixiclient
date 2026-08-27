import type {
  ChatAuthor,
  ChatDelivery,
  ChatTargetPorts,
} from "@features/game/chat/chat.targets";
import type { HandlerContext } from "@shared/gateway-adapter/ws-router";
import { create } from "@bufbuild/protobuf";
import {
  ChatErrorReason,
  ChatMessageErrorSchema,
  ChatMessageSchema,
  type ChatSendMessage,
  ChatSendMessageSchema,
} from "@dofus/proto/chat_pb";
import { ChatChannel } from "@dofus/proto/common_pb";
import { DofusMessageSchema } from "@dofus/proto/server_messages_pb";
import {
  MAX_MESSAGE_LENGTH,
  parseDestination,
} from "@features/game/chat/chat.channels";
import { ChatFloodService } from "@features/game/chat/chat.flood.service";
import { resolveRouting } from "@features/game/chat/chat.targets";
import { FightRegistryService } from "@modules/fight/registry/fight.registry";
import { PlayerPresenceService } from "@modules/player-presence/player-presence.service";
import { Injectable } from "@nestjs/common";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";
import { MessageHandler } from "@shared/gateway-adapter/message-handler.decorator";
import { SessionRegistry } from "@shared/gateway-adapter/session-registry";

@Injectable()
export class ChatHandler {
  constructor(
    private readonly sessions: SessionRegistry,
    private readonly presence: PlayerPresenceService,
    private readonly fights: FightRegistryService,
    private readonly flood: ChatFloodService,
    private readonly frames: GatewayFrameService
  ) {}

  @MessageHandler(ChatSendMessageSchema)
  handle(ctx: HandlerContext, msg: ChatSendMessage): void {
    const session = this.sessions.get(ctx.sessionId);

    if (!session?.characterId) {
      return;
    }

    const player = this.presence.getByCharacter(session.characterId);

    if (!player) {
      return;
    }

    const author: ChatAuthor = {
      sessionId: ctx.sessionId,
      characterId: session.characterId,
      name: player.name,
      mapId: player.mapId,
    };

    const destination = parseDestination(msg.destination);
    const text = msg.message.trim().slice(0, MAX_MESSAGE_LENGTH);

    if (text.length === 0) {
      this.reject(author, ChatChannel.GENERAL, ChatErrorReason.EMPTY_MESSAGE);

      return;
    }

    const routing = resolveRouting(destination, author, this.ports());

    if (!routing.ok) {
      this.reject(
        author,
        this.channelOf(destination),
        routing.reason,
        routing.detail
      );

      return;
    }

    // The cooldown is charged only once the message is known to be deliverable,
    // so a rejected /b does not burn the author's two minutes.
    const channel = this.channelOf(destination);
    const now = Date.now();
    const remaining = this.flood.check(author.characterId, channel, now);

    if (remaining > 0) {
      this.reject(author, channel, ChatErrorReason.FLOOD, "", remaining);

      return;
    }

    this.flood.commit(author.characterId, channel, now);
    this.deliver(routing.delivery, author, text, msg.itemsData);
  }

  private ports(): ChatTargetPorts {
    return {
      sessionsOnMap: (mapId) => this.presence.sessionsOnMap(mapId),
      allSessions: () => this.presence.allSessions(),
      getByName: (name) => this.presence.getByName(name),
      teamSessions: (sessionId) => {
        const fight = this.fights.getBySession(sessionId);
        const self = fight?.fighters().find((f) => f.sessionId === sessionId);

        return (
          self?.team
            ?.fighters()
            .map((f) => f.sessionId)
            .filter((id) => id.length > 0) ?? undefined
        );
      },
    };
  }

  /** The channel a message is *charged* and *reported* against. */
  private channelOf(
    destination: ReturnType<typeof parseDestination>
  ): ChatChannel {
    return destination.kind === "channel"
      ? destination.channel
      : ChatChannel.WHISPER_TO;
  }

  private deliver(
    delivery: ChatDelivery,
    author: ChatAuthor,
    text: string,
    itemsData: string
  ): void {
    if (delivery.kind === "broadcast") {
      this.frames.broadcast(
        delivery.targets,
        this.message(
          delivery.channel,
          author.characterId,
          author.name,
          text,
          itemsData
        )
      );

      return;
    }

    // Retail sends two different frames: the recipient sees it as coming FROM
    // the author, the author sees it as going TO the recipient. The sender name
    // carried by each frame is the *other* party, which is what the client
    // renders after the "de"/"à" preposition.
    this.frames.broadcast(
      [delivery.targetSessionId],
      this.message(
        ChatChannel.WHISPER_FROM,
        author.characterId,
        author.name,
        text,
        itemsData
      )
    );

    this.frames.broadcast(
      [author.sessionId],
      this.message(
        ChatChannel.WHISPER_TO,
        author.characterId,
        delivery.targetName,
        text,
        itemsData
      )
    );
  }

  private message(
    channel: ChatChannel,
    senderId: string,
    senderName: string,
    message: string,
    itemsData: string
  ) {
    return create(DofusMessageSchema, {
      payload: {
        case: "chatMessage",
        value: create(ChatMessageSchema, {
          success: true,
          channel,
          senderId,
          senderName,
          message,
          itemsData,
        }),
      },
    });
  }

  private reject(
    author: ChatAuthor,
    channel: ChatChannel,
    reason: ChatErrorReason,
    detail = "",
    remainingSeconds = 0
  ): void {
    this.frames.broadcast(
      [author.sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "chatMessageError",
          value: create(ChatMessageErrorSchema, {
            channel,
            reason,
            remainingSeconds,
            detail,
          }),
        },
      })
    );
  }
}
