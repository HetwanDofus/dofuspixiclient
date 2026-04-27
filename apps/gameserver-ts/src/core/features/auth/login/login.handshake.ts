import { create } from "@bufbuild/protobuf";
import { HandshakeConnectionKeySchema } from "@dofus/proto/account_pb";
import { DofusMessageSchema } from "@dofus/proto/server_messages_pb";
import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";
import type { Session } from "@shared/gateway-adapter/session-registry";

@Injectable()
export class LoginHandshake {
  private readonly logger = new Logger(LoginHandshake.name);

  constructor(private readonly frames: GatewayFrameService) {}

  @OnEvent("session.opened")
  onSessionOpened(session: Session): void {
    const key = crypto.randomUUID().replace(/-/g, "").slice(0, 16);

    this.frames.broadcast(
      [session.sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "handshakeConnectionKey",
          value: create(HandshakeConnectionKeySchema, {
            connectionKey: key,
          }),
        },
      }),
    );

    this.logger.log(`Sent connection key to session=${session.sessionId}`);
  }
}
