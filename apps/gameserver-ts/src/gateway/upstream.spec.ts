import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";

import { create } from "@bufbuild/protobuf";
import { AccountSendTicketSchema } from "@dofus/proto/account_pb";
import {
  type ClientMessage,
  ClientMessageSchema,
} from "@dofus/proto/client_messages_pb";
import {
  type GatewayFrame,
  GatewayFrameSchema,
  HandoffControl_Phase,
} from "@dofus/proto/gateway/v1/gateway_frame_pb";
import { type FramedSocket, listen } from "@dofus/uds-transport";

import { logSink } from "./log-sink.ts";
import { logger } from "./logger.ts";
import { SessionRegistry } from "./session-registry.ts";
import { Upstream } from "./upstream.ts";

// These tests drive the real UDS transport against a fake core process, because
// the defect under test (QA-048) lives in the reconnect path of that transport:
// a mocked socket would reconnect the way we *think* it does, which is exactly
// the assumption that was wrong.

const BUFFER_CAP = 10_000;
const RECONNECT_MS = 500; // uds-transport default retry delay

type FakeCore = {
  /** Every frame this core instance received, in arrival order. */
  frames: GatewayFrame[];
  stop: () => void;
};

let sockSeq = 0;

function sockPath(): string {
  // Unix socket paths are capped near 104 bytes — keep them short and in /tmp,
  // as the gateway itself does (see gateway/main.ts).
  sockSeq += 1;
  return `/tmp/dofus-up-spec-${process.pid}-${sockSeq}.sock`;
}

function startCore(
  path: string,
  opts: { answerHandoff?: boolean } = {}
): FakeCore {
  try {
    unlinkSync(path);
  } catch {
    // no stale socket file — nothing to clean
  }

  const frames: GatewayFrame[] = [];

  const server = listen({
    path,
    onConnection: (socket: FramedSocket) => ({
      onFrame: (f) => {
        frames.push(f);

        if (!opts.answerHandoff || f.kind.case !== "handoff") {
          return;
        }

        if (f.kind.value.phase === HandoffControl_Phase.DRAIN) {
          socket.send(
            create(GatewayFrameSchema, {
              kind: {
                case: "handoff",
                value: {
                  phase: HandoffControl_Phase.SNAPSHOT,
                  snapshot: new Uint8Array([1, 2, 3]),
                },
              },
            })
          );
        }

        if (f.kind.value.phase === HandoffControl_Phase.RESTORE) {
          socket.send(
            create(GatewayFrameSchema, {
              kind: {
                case: "handoff",
                value: {
                  phase: HandoffControl_Phase.READY,
                  snapshot: new Uint8Array(),
                },
              },
            })
          );
        }
      },
      onClose: () => undefined,
    }),
  });

  return {
    frames,
    stop: () => {
      server.stop(true);

      try {
        unlinkSync(path);
      } catch {
        // already gone
      }
    },
  };
}

function ticket(raw: string): ClientMessage {
  return create(ClientMessageSchema, {
    payload: {
      case: "accountSendTicket",
      value: create(AccountSendTicketSchema, { ticket: raw }),
    },
  });
}

/** Tickets carried by the clientEnv frames a core received, in order. */
function tickets(core: FakeCore): string[] {
  const out: string[] = [];

  for (const f of core.frames) {
    if (f.kind.case !== "clientEnv") {
      continue;
    }

    const payload = f.kind.value.message?.payload;

    if (payload?.case === "accountSendTicket") {
      out.push(payload.value.ticket);
    }
  }

  return out;
}

const kinds = (core: FakeCore): string[] =>
  core.frames.map((f) => f.kind.case ?? "unset");

async function until(
  pred: () => boolean,
  label: string,
  timeoutMs = 8_000
): Promise<void> {
  const started = Date.now();

  while (!pred()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error(`timed out waiting for: ${label}`);
    }

    await Bun.sleep(10);
  }
}

/**
 * Runs `fn` with the gateway logger audible at `error`, collecting the messages
 * that reach the in-memory sink. Children inherit the level at construction, so
 * anything built inside `fn` is covered; anything built before it is not.
 */
async function withCapturedErrors(fn: () => Promise<void>): Promise<string[]> {
  const seen: string[] = [];
  const unsubscribe = logSink.subscribe((entry) => seen.push(entry.msg));

  logger.level = "error";

  try {
    await fn();
  } finally {
    logger.level = "silent";
    unsubscribe();
  }

  return seen;
}

const cleanups: Array<() => void> = [];

function track<T extends { stop: () => void }>(core: T): T {
  cleanups.push(() => core.stop());

  return core;
}

beforeAll(() => {
  // The gateway logger fans out to pino-pretty in dev; keep the test output
  // readable. Children inherit the level at construction time.
  logger.level = "silent";
});

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
});

describe("Upstream — core restart (QA-048)", () => {
  test("forwards straight through while the core is up", async () => {
    const path = sockPath();
    const core = track(startCore(path));
    const up = new Upstream("game", new SessionRegistry());
    const link = up.connect(path);

    up.setActive(link);
    await link.ready;

    up.forwardClient({ sessionId: "s1", message: ticket("nominal") });

    await until(() => tickets(core).length === 1, "frame delivered");

    expect(up.status()).toMatchObject({ buffering: false, buffered: 0 });
    expect(tickets(core)).toEqual(["nominal"]);

    link.socket.close();
  });

  test("resumes forwarding after the active core restarts", async () => {
    const path = sockPath();
    const first = startCore(path);
    const up = new Upstream("game", new SessionRegistry());
    const link = up.connect(path);

    up.setActive(link);
    await link.ready;

    up.forwardClient({ sessionId: "s1", message: ticket("before") });
    await until(() => tickets(first).length === 1, "pre-restart delivery");

    // `docker restart gamed`
    first.stop();
    await until(() => up.status().buffering, "buffering after core death");

    up.forwardClient({ sessionId: "s1", message: ticket("during") });

    expect(up.status().buffered).toBe(1);

    const second = track(startCore(path));

    // The transport reconnects the same link object; before the fix, nothing
    // lowered `buffering` on that path and the gateway stayed frozen for good.
    await until(
      () => !up.status().buffering,
      "buffering cleared on reconnect",
      RECONNECT_MS * 8
    );

    up.forwardClient({ sessionId: "s1", message: ticket("after") });

    await until(() => tickets(second).length === 2, "post-restart delivery");

    expect(tickets(second)).toEqual(["during", "after"]);
    expect(up.status()).toMatchObject({ buffering: false, buffered: 0 });

    link.socket.close();
  }, 20_000);

  test("replays session lifecycle frames, in order, around an outage", async () => {
    const path = sockPath();
    const first = startCore(path);
    const up = new Upstream("game", new SessionRegistry());
    const link = up.connect(path);

    up.setActive(link);
    await link.ready;

    first.stop();
    await until(() => up.status().buffering, "buffering after core death");

    // A player connecting during the outage: the announcement must survive it,
    // and must reach the core before the frames that reference the session.
    up.sessionOpen("s9", "acc-1", "char-1", "10.0.0.1");
    up.forwardClient({ sessionId: "s9", message: ticket("hello") });
    up.sessionClose("s9", "client_close");

    expect(up.status().buffered).toBe(3);

    const second = track(startCore(path));

    await until(
      () => second.frames.length === 3,
      "lifecycle replayed",
      RECONNECT_MS * 8
    );

    expect(kinds(second)).toEqual(["sessionOpen", "clientEnv", "sessionClose"]);

    link.socket.close();
  }, 20_000);
});

describe("Upstream — buffer behaviour under a long outage", () => {
  test("caps the queue, drops the oldest, and says so once", async () => {
    const path = sockPath();
    const first = startCore(path);
    let second!: FakeCore;
    const overflow = 50;

    const logged = await withCapturedErrors(async () => {
      const up = new Upstream("game", new SessionRegistry());
      const link = up.connect(path);

      up.setActive(link);
      await link.ready;

      first.stop();
      await until(() => up.status().buffering, "buffering after core death");

      for (let i = 0; i < BUFFER_CAP + overflow; i += 1) {
        up.forwardClient({ sessionId: "s1", message: ticket(`m${i}`) });
      }

      expect(up.status().buffered).toBe(BUFFER_CAP);

      second = track(startCore(path));

      await until(
        () => tickets(second).length === BUFFER_CAP,
        "full buffer replayed",
        RECONNECT_MS * 8 + 5_000
      );

      link.socket.close();
    });

    const replayed = tickets(second);

    expect(replayed.at(0)).toBe(`m${overflow}`);
    expect(replayed.at(-1)).toBe(`m${BUFFER_CAP + overflow - 1}`);

    // One line opening the overflow episode, one tally closing it — not one
    // line per dropped frame.
    expect(logged.filter((m) => m.includes("dropping oldest"))).toHaveLength(1);
    expect(logged.filter((m) => m.includes("frames lost"))).toHaveLength(1);
  }, 30_000);

  test("overflowing stays cheap — no per-frame logging", async () => {
    const path = sockPath();
    const first = startCore(path);
    const up = new Upstream("game", new SessionRegistry());
    const link = up.connect(path);

    up.setActive(link);
    await link.ready;

    first.stop();
    await until(() => up.status().buffering, "buffering after core death");

    const msg = ticket("load");

    // Fill to the cap, then measure only the drop-oldest path — the one a long
    // outage with a chatty client hammers.
    for (let i = 0; i < BUFFER_CAP; i += 1) {
      up.forwardClient({ sessionId: "s1", message: msg });
    }

    const overflowing = 200_000;
    const started = Bun.nanoseconds();

    for (let i = 0; i < overflowing; i += 1) {
      up.forwardClient({ sessionId: "s1", message: msg });
    }

    const elapsedMs = (Bun.nanoseconds() - started) / 1e6;

    // Coarse guard against an O(n)-per-frame regression in the overflow path;
    // measured around 60ms here. The precise guard against per-frame logging
    // is the log-count assertion in the test above — this one catches gross
    // throughput loss without flaking on a slow CI box.
    expect(elapsedMs).toBeLessThan(500);
    expect(up.status().buffered).toBe(BUFFER_CAP);

    link.socket.close();
  }, 30_000);
});

describe("Upstream — handoff still holds", () => {
  test("switches cores, and the retired core dying does not re-arm buffering", async () => {
    const pathA = sockPath();
    const pathB = sockPath();
    const coreA = track(startCore(pathA, { answerHandoff: true }));
    const coreB = track(startCore(pathB, { answerHandoff: true }));

    const up = new Upstream("game", new SessionRegistry());
    const link = up.connect(pathA);

    up.setActive(link);
    await link.ready;

    await up.handoffTo(pathB);

    expect(up.status()).toMatchObject({
      active: pathB,
      standby: null,
      buffering: false,
    });

    up.forwardClient({ sessionId: "s1", message: ticket("post-handoff") });
    await until(() => tickets(coreB).length === 1, "delivery to new core");

    // The retired core going away is expected and must not stall the new one.
    coreA.stop();
    await Bun.sleep(RECONNECT_MS * 2);

    expect(up.status().buffering).toBe(false);

    up.forwardClient({ sessionId: "s1", message: ticket("still-alive") });
    await until(() => tickets(coreB).length === 2, "traffic still flowing");

    expect(tickets(coreB)).toEqual(["post-handoff", "still-alive"]);
  }, 20_000);

  test("a failed handoff falls back to the active core instead of wedging", async () => {
    const pathA = sockPath();
    const pathC = sockPath();
    const coreA = track(startCore(pathA));
    // Connects, then never answers DRAIN — the handoff must time out.
    track(startCore(pathC));

    const up = new Upstream("game", new SessionRegistry(), 200);
    const link = up.connect(pathA);

    up.setActive(link);
    await link.ready;

    await expect(up.handoffTo(pathC)).rejects.toThrow(/timeout/);

    // Left as it was, `standby` would reject every later handoff and
    // `buffering` would freeze every session — QA-048 by another road.
    expect(up.status()).toMatchObject({
      active: pathA,
      standby: null,
      buffering: false,
    });

    up.forwardClient({
      sessionId: "s1",
      message: ticket("after-failed-handoff"),
    });
    await until(() => tickets(coreA).length === 1, "fallback delivery");

    expect(tickets(coreA)).toEqual(["after-failed-handoff"]);

    link.socket.close();
  });
});
