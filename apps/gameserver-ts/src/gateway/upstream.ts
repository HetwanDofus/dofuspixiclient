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
  // Everything bound for the core goes through this one queue — session
  // lifecycle frames included — so a replay after an outage keeps the
  // open → messages → close order the core relies on.
  private buffer: GatewayFrame[] = [];
  private dropped = 0;
  private buffering = false;
  private pendingSnapshotAck: ((snapshot: Uint8Array) => void) | null = null;
  private pendingRestoreAck: (() => void) | null = null;
  private readonly log;

  constructor(
    readonly role: Role,
    private readonly sessions: SessionRegistry,
    private readonly handoffTimeoutMs: number = HANDOFF_TIMEOUT_MS
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

          // The transport reconnects the *same* link object in place, so a core
          // that dies and comes back never passes through setActive() again —
          // the only other place that lowers `buffering`. Without this the
          // gateway stays in buffering mode for good and every client frame
          // piles up unsent until BUFFER_CAP.
          // A handoff owns `buffering` for its whole duration: if a standby is
          // in flight, leave the flag to handoffTo().
          if (this.active === link && this.buffering && !this.standby) {
            this.log.warn(
              { path, buffered: this.buffer.length },
              "active core reconnected — resuming"
            );

            this.resume();
          }
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
    this.resume();
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
    this.send(
      create(GatewayFrameSchema, {
        kind: {
          case: "clientEnv",
          value: { sessionId: msg.sessionId, message: msg.message },
        },
      })
    );
  }

  sessionOpen(
    sessionId: string,
    accountId: string,
    characterId: string,
    remoteAddr: string
  ) {
    // Buffered like any other frame: a session that opens while the core is
    // down must still be announced when it comes back, and must be announced
    // *before* the client frames that reference it.
    this.send(
      create(GatewayFrameSchema, {
        kind: {
          case: "sessionOpen",
          value: { sessionId, accountId, characterId, remoteAddr },
        },
      })
    );
  }

  sessionClose(sessionId: string, reason: string) {
    this.send(
      create(GatewayFrameSchema, {
        kind: { case: "sessionClose", value: { sessionId, reason } },
      })
    );
  }

  private resume() {
    this.buffering = false;
    this.flushBuffer();
  }

  private send(frame: GatewayFrame) {
    if (this.buffering || !this.active) {
      this.pushBuffered(frame);

      return;
    }

    this.active.socket.send(frame);
  }

  private pushBuffered(frame: GatewayFrame) {
    if (this.buffer.length >= BUFFER_CAP) {
      // One line per overflow episode, not one per dropped frame: every log
      // entry is parsed by the in-memory sink and pushed to the Ink UI, so a
      // saturated buffer used to cost ~190ms and 200k re-renders per 200k
      // dropped frames — a self-inflicted stall exactly when the gateway is
      // already struggling. The tally goes out once, at flush.
      if (this.dropped === 0) {
        this.log.error(
          { cap: BUFFER_CAP },
          "buffer overflow — dropping oldest frames"
        );
      }

      this.dropped += 1;

      this.buffer.shift();
    }

    this.buffer.push(frame);
  }

  private flushBuffer() {
    if (!this.active || this.buffer.length === 0) {
      this.reportDropped();

      return;
    }

    // Swap the queue out before sending: anything re-entering send() while we
    // drain must land in the new buffer, not in the one being replayed.
    const active = this.active;
    const replay = this.buffer;

    this.buffer = [];

    for (const frame of replay) {
      active.socket.send(frame);
    }

    this.log.info({ flushed: replay.length }, "buffer flushed to core");

    this.reportDropped();
  }

  private reportDropped() {
    if (this.dropped === 0) {
      return;
    }

    this.log.error(
      { dropped: this.dropped, cap: BUFFER_CAP },
      "frames lost to buffer overflow during outage"
    );

    this.dropped = 0;
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

    try {
      await withTimeout(
        this.standby.ready,
        this.handoffTimeoutMs,
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
        this.handoffTimeoutMs,
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
        this.handoffTimeoutMs,
        "restore ack from standby"
      );

      this.pendingRestoreAck = null;

      const old = this.active;
      this.active = this.standby;
      this.standby = null;
      this.resume();

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

      this.log.info(
        { from: old.path, to: this.active.path },
        "handoff complete"
      );
    } catch (err) {
      // A half-finished handoff must not wedge the gateway: a leftover
      // `standby` rejects every later attempt, and `buffering` left true
      // freezes every session — the QA-048 failure mode by another road.
      this.abortHandoff(err as Error);

      throw err;
    }
  }

  private abortHandoff(err: Error) {
    this.log.error(
      { err: err.message, standby: this.standby?.path ?? null },
      "handoff failed — falling back to the active core"
    );

    this.pendingSnapshotAck = null;
    this.pendingRestoreAck = null;

    const standby = this.standby;
    this.standby = null;
    standby?.socket.close();

    this.resume();
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
