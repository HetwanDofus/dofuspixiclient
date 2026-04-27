import type { HandlerContext } from "@shared/gateway-adapter/ws-router";
import { create } from "@bufbuild/protobuf";
import {
  ChatMessageSchema,
  type ChatSendMessage,
  ChatSendMessageSchema,
} from "@dofus/proto/chat_pb";
import { ChatChannel } from "@dofus/proto/common_pb";
import { DofusMessageSchema } from "@dofus/proto/server_messages_pb";
import { PlayerPresenceService } from "@modules/player-presence/player-presence.service";
import { Injectable } from "@nestjs/common";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";
import { MessageHandler } from "@shared/gateway-adapter/message-handler.decorator";
import { SessionRegistry } from "@shared/gateway-adapter/session-registry";
import { match } from "ts-pattern";

@Injectable()
export class ChatHandler {
  constructor(
    private readonly sessions: SessionRegistry,
    private readonly presence: PlayerPresenceService,
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

    const channel = this.resolveChannel(msg.destination);
    const targets = this.getTargets(channel, player);

    this.frames.broadcast(
      targets,
      create(DofusMessageSchema, {
        payload: {
          case: "chatMessage",
          value: create(ChatMessageSchema, {
            success: true,
            channel,
            senderId: session.characterId,
            senderName: player.name,
            message: msg.message,
          }),
        },
      })
    );
  }

  private resolveChannel(destination: string): ChatChannel {
    const firstChar = destination.charAt(0);

    return match(firstChar)
      .with("*", () => ChatChannel.GENERAL)
      .with("#", () => ChatChannel.TEAM)
      .with("$", () => ChatChannel.GUILD)
      .with("%", () => ChatChannel.ALIGNMENT)
      .with("?", () => ChatChannel.RECRUITMENT)
      .with(":", () => ChatChannel.TRADE)
      .with("!", () => ChatChannel.PVP)
      .with("i", () => ChatChannel.ADVICE)
      .with("^", () => ChatChannel.DATING)
      .otherwise(() => ChatChannel.GENERAL);
  }

  private getTargets(
    channel: ChatChannel,
    player: { mapId: number }
  ): string[] {
    // Map chat broadcasts to all players on same map
    if (channel === ChatChannel.DATING) {
      return this.presence.sessionsOnMap(player.mapId);
    }

    // Other channels broadcast to all online players (simplified)
    // TODO: Implement guild, team, alignment, recruitment, trade broadcasts
    return this.presence.sessionsOnMap(player.mapId);
  }
}
