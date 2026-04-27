import type { ClientMessage } from "@dofus/proto/client_messages_pb";
import { create } from "@bufbuild/protobuf";
import {
  type GatewayFrame,
  GatewayFrameSchema,
  HandoffControl_Phase,
} from "@dofus/proto/gateway/v1/gateway_frame_pb";
import {
  encodeDofusMessage,
  type FramedSocket,
  connect as udsConnect,
} from "@dofus/uds-transport";
import { match } from "ts-pattern";

import type { Role, SessionRegistry } from "./session-registry.ts";
import { logger } from "./logger.ts";

const BUFFER_CAP = 10_000;
const HANDOFF_TIMEOUT_MS = 10_000;

type PendingClientMsg = { sessionId: string; message: ClientMessage };

type CoreLink = {
  path: string;
  socket: FramedSocket;
  ready: Promise<void>;
  resolveReady: () => void;
};

export class Upstream {
  private active: CoreLink | null = null;
  private standby: CoreLink | null = null;
  private buffer: PendingClientMsg[] = [];
  private buffering = false;
  private pendingSnapshotAck: ((snapshot: Uint8Array) => void) | null = null;
  private pendingRestoreAck: (() => void) | null = null;
  private readonly log;

  constructor(
    readonly role: Role,
    private readonly sessions: SessionRegistry
  ) {
    this.log = logger.child({ mod: "upstream", role });
  }

  connect(path: string): CoreLink {
    let resolveReady!: () => void;
    const ready = new Promise<void>((r) => {
      resolveReady = r;
    });
    const link: CoreLink = {
      path,
      ready,
      resolveReady,
      socket: udsConnect({
        path,
        logger: this.log,
        onConnect: () => {
          this.log.info({ path }, "connected to core");

          link.resolveReady();
        },
        onDisconnect: () => {
          // Only flip to buffering if the *active* link just died. A retired
          // (post-handoff) link disconnecting is expected and must not stall
          // traffic now flowing to the new active.
          if (this.active === link) {
            this.log.warn({ path }, "active core disconnected — buffering");

            this.buffering = true;
          } else {
            this.log.info({ path }, "retired core disconnected (expected)");
          }
        },
        onFrame: (f) => this.onCoreFrame(f),
      }),
    };
    return link;
  }

  setActive(link: CoreLink) {
    this.active = link;
    this.buffering = false;
    this.flushBuffer();
  }

  status() {
    return {
      role: this.role,
      active: this.active?.path ?? null,
      standby: this.standby?.path ?? null,
      buffering: this.buffering,
      buffered: this.buffer.length,
    };
  }

  forwardClient(msg: PendingClientMsg) {
    if (this.buffering || !this.active) {
      if (this.buffer.length >= BUFFER_CAP) {
        this.log.error(
          { cap: BUFFER_CAP },
          "buffer overflow — dropping oldest"
        );
        this.buffer.shift();
      }

      this.buffer.push(msg);

      return;
    }

    this.sendClientEnvelope(this.active, msg);
  }

  private sendClientEnvelope(link: CoreLink, msg: PendingClientMsg) {
    link.socket.send(
      create(GatewayFrameSchema, {
        kind: {
          case: "clientEnv",
          value: { sessionId: msg.sessionId, message: msg.message },
        },
      })
    );
  }

  private flushBuffer() {
    if (!this.active) {
      return;
    }

    for (const m of this.buffer) {
      this.sendClientEnvelope(this.active, m);
    }

    this.buffer = [];
  }

  sessionOpen(
    sessionId: string,
    accountId: string,
    characterId: string,
    remoteAddr: string
  ) {
    const frame = create(GatewayFrameSchema, {
      kind: {
        case: "sessionOpen",
        value: { sessionId, accountId, characterId, remoteAddr },
      },
    });

    (this.active ?? this.standby)?.socket.send(frame);
  }

  sessionClose(sessionId: string, reason: string) {
    const frame = create(GatewayFrameSchema, {
      kind: { case: "sessionClose", value: { sessionId, reason } },
    });

    (this.active ?? this.standby)?.socket.send(frame);
  }

  private onCoreFrame(frame: GatewayFrame) {
    match(frame.kind)
      .with({ case: "coreEnv" }, ({ value }) => {
        if (!value.message) {
          return;
        }

        const delivered = this.sessions.sendBytes(
          value.sessionIds,
          encodeDofusMessage(value.message)
        );
        this.log.info(
          { sessions: value.sessionIds.length, delivered, payload: value.message.payload.case },
          "coreEnv → ws"
        );
      })
      .with({ case: "handoff" }, ({ value }) =>
        this.onHandoffFrame(value.phase, value.snapshot)
      )
      .with({ case: "hb" }, () => undefined)
      .otherwise((k) =>
        this.log.warn({ kind: k.case }, "unexpected frame from core")
      );
  }

  async handoffTo(standbyPath: string): Promise<void> {
    if (!this.active) {
      throw new Error("no active core to hand off from");
    }

    if (this.standby) {
      throw new Error("handoff already in progress");
    }

    this.standby = this.connect(standbyPath);

    await withTimeout(
      this.standby.ready,
      HANDOFF_TIMEOUT_MS,
      "standby connect"
    );

    this.buffering = true;

    this.active.socket.send(
      create(GatewayFrameSchema, {
        kind: {
          case: "handoff",
          value: {
            phase: HandoffControl_Phase.DRAIN,
            snapshot: new Uint8Array(),
          },
        },
      })
    );

    const snapshot = await withTimeout(
      new Promise<Uint8Array>((r) => {
        this.pendingSnapshotAck = r;
      }),
      HANDOFF_TIMEOUT_MS,
      "snapshot from active"
    );

    this.pendingSnapshotAck = null;

    this.standby.socket.send(
      create(GatewayFrameSchema, {
        kind: {
          case: "handoff",
          value: { phase: HandoffControl_Phase.RESTORE, snapshot },
        },
      })
    );

    await withTimeout(
      new Promise<void>((r) => {
        this.pendingRestoreAck = r;
      }),
      HANDOFF_TIMEOUT_MS,
      "restore ack from standby"
    );

    this.pendingRestoreAck = null;

    const old = this.active;
    this.active = this.standby;
    this.standby = null;
    this.buffering = false;
    this.flushBuffer();

    old.socket.send(
      create(GatewayFrameSchema, {
        kind: {
          case: "handoff",
          value: {
            phase: HandoffControl_Phase.SHUTDOWN,
            snapshot: new Uint8Array(),
          },
        },
      })
    );

    setTimeout(() => old.socket.close(), 500);

    this.log.info({ from: old.path, to: this.active.path }, "handoff complete");
  }

  private onHandoffFrame(phase: HandoffControl_Phase, snapshot: Uint8Array) {
    match(phase)
      .with(HandoffControl_Phase.SNAPSHOT, () =>
        this.pendingSnapshotAck?.(snapshot)
      )
      .with(HandoffControl_Phase.READY, () => this.pendingRestoreAck?.())
      .otherwise(() => undefined);
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) =>
      setTimeout(() => rej(new Error(`timeout: ${label}`)), ms)
    ),
  ]);
}
