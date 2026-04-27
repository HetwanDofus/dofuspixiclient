// Owns the UDS listener on the core side. Translates inbound GatewayFrame
// into router dispatch with decoded dofus.ClientMessage, and exposes a typed
// broadcast API for slices emitting dofus.DofusMessage back through the
// gateway.

import type { DofusMessage } from "@dofus/proto/server_messages_pb";
import { create } from "@bufbuild/protobuf";
import {
  CoreEnvelopeSchema,
  type GatewayFrame,
  GatewayFrameSchema,
  type HandoffControl_Phase,
  HandoffControlSchema,
} from "@dofus/proto/gateway/v1/gateway_frame_pb";
import { type FramedSocket, listen as udsListen } from "@dofus/uds-transport";
import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { SessionRegistry } from "@shared/gateway-adapter/session-registry";
import { WsRouter } from "@shared/gateway-adapter/ws-router";
import { match } from "ts-pattern";

export type HandoffFrameHandler = (
  phase: HandoffControl_Phase,
  snapshot?: Uint8Array
) => void | Promise<void>;

@Injectable()
export class GatewayFrameService implements OnModuleDestroy {
  private readonly logger = new Logger(GatewayFrameService.name);

  private server: ReturnType<typeof udsListen> | null = null;
  private socket: FramedSocket | null = null;
  private handoffHandler: HandoffFrameHandler | null = null;

  constructor(
    private readonly router: WsRouter,
    private readonly sessions: SessionRegistry
  ) {}

  setHandoffHandler(fn: HandoffFrameHandler) {
    this.handoffHandler = fn;
  }

  listen(path: string) {
    this.server = udsListen({
      path,
      onConnection: (socket) => {
        if (this.socket) {
          this.logger.warn("second gateway connection — replacing previous");
          this.socket.close();
        }

        this.socket = socket;
        this.logger.log("gateway connected");

        return {
          onFrame: (f) => this.onFrame(f),
          onClose: () => {
            this.logger.warn("gateway disconnected");

            if (this.socket === socket) {
              this.socket = null;
            }
          },
        };
      },
    });
  }

  async onModuleDestroy() {
    this.socket?.close();
    this.server?.stop?.();
  }

  send(frame: GatewayFrame) {
    if (!this.socket) {
      this.logger.warn(`dropped frame ${frame.kind.case} — no gateway link`);
      return;
    }

    this.socket.send(frame);
  }

  // Callers construct a DofusMessage via create(<TypeSchema>, {...}).
  broadcast(sessionIds: readonly string[], message: DofusMessage) {
    if (sessionIds.length === 0) {
      return;
    }

    const env = create(CoreEnvelopeSchema, {
      sessionIds: [...sessionIds],
      message,
    });

    this.send(
      create(GatewayFrameSchema, { kind: { case: "coreEnv", value: env } })
    );
  }

  sendHandoff(phase: HandoffControl_Phase, snapshot?: Uint8Array) {
    const hc = create(HandoffControlSchema, {
      phase,
      snapshot: snapshot ?? new Uint8Array(),
    });

    this.send(
      create(GatewayFrameSchema, { kind: { case: "handoff", value: hc } })
    );
  }

  private onFrame(frame: GatewayFrame) {
    match(frame.kind)
      .with({ case: "sessionOpen" }, ({ value }) =>
        this.sessions.open({
          sessionId: value.sessionId,
          accountId: value.accountId,
          characterId: value.characterId,
          remoteAddr: value.remoteAddr,
        })
      )
      .with({ case: "sessionClose" }, ({ value }) =>
        this.sessions.close(value.sessionId, value.reason)
      )
      .with({ case: "clientEnv" }, ({ value }) => {
        const inner = value.message?.payload.value;

        if (!inner) {
          return;
        }

        void this.router.dispatch({ sessionId: value.sessionId }, inner);
      })
      .with({ case: "handoff" }, ({ value }) =>
        this.handoffHandler?.(value.phase, value.snapshot)
      )
      .with({ case: "hb" }, ({ value }) =>
        this.send(create(GatewayFrameSchema, { kind: { case: "hb", value } }))
      )
      .otherwise((k) =>
        this.logger.warn(`unexpected frame from gateway: ${k.case}`)
      );
  }
}
