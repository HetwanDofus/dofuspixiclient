import "reflect-metadata";

import { beforeEach, describe, expect, test } from "bun:test";

import type { DofusMessage } from "@dofus/proto/server_messages_pb";
import type { BigStoreFlow } from "@modules/exchange/big-store.flow";
import type { ExchangeSession } from "@modules/exchange/exchange.types";
import type { StorageFlow } from "@modules/exchange/storage.flow";
import type { TradeFlow } from "@modules/exchange/trade.flow";
import type { FightRegistryService } from "@modules/fight/registry/fight.registry";
import type { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";
import { ExchangeType } from "@dofus/proto/common_pb";
import { ExchangeFramesService } from "@modules/exchange/exchange.frames.service";
import { ExchangeRegistryService } from "@modules/exchange/exchange.registry";
import { ExchangeSerializer } from "@modules/exchange/exchange.serializer";
import { ExchangeService } from "@modules/exchange/exchange.service";
import { bankOwner, OwnerKind } from "@modules/items/item-owner";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { SessionRegistry } from "@shared/gateway-adapter/session-registry";

const SESSION = "s-1";
const ACCOUNT = "acc-1";
const CHARACTER = "char-1";

function frameCapture() {
  const sent: DofusMessage[] = [];

  const gateway = {
    broadcast: (_targets: readonly string[], msg: DofusMessage) => {
      sent.push(msg);
    },
  } as unknown as GatewayFrameService;

  return { sent, gateway, cases: () => sent.map((m) => m.payload.case) };
}

/**
 * A `TradeFlow` that is never reached.
 *
 * Every case here is a storage, and `ExchangeService` routes on
 * `session.kind`, so the trade flow is genuinely unused — a stub that
 * throws would be equivalent. It exists only to satisfy the constructor.
 */
function noTrades(): TradeFlow {
  return { tradeOf: () => undefined } as unknown as TradeFlow;
}

/** No auction house is open in any of these cases. */
function noBigStore(): BigStoreFlow {
  return { forget: () => {} } as unknown as BigStoreFlow;
}

describe("ExchangeFramesService.open", () => {
  test("sends EC and then EL, in that order", () => {
    const { gateway, cases } = frameCapture();
    const frames = new ExchangeFramesService(gateway);

    const session: ExchangeSession = {
      sessionId: SESSION,
      characterId: CHARACTER,
      accountId: ACCOUNT,
      kind: ExchangeType.EXCHANGE_STORAGE,
      remote: bankOwner(ACCOUNT),
      phase: "open",
      lockKey: SESSION,
      openedAt: 0,
    };

    frames.open(session, [], 0n);

    // Not cosmetic. `dofus.datacenter.Storage` has no inventory array
    // until an `EL` assigns one, so an `Es` arriving before it is
    // dropped in silence. The pair exists precisely so that no caller
    // can send one without the other.
    expect(cases()).toEqual(["exchangeCreate", "exchangeList"]);
  });
});

describe("ExchangeService", () => {
  let registry: ExchangeRegistryService;
  let sessions: SessionRegistry;
  let service: ExchangeService;
  let announced: number;
  let inFight: boolean;
  let capture: ReturnType<typeof frameCapture>;

  beforeEach(() => {
    sessions = new SessionRegistry(new EventEmitter2());
    registry = new ExchangeRegistryService(sessions);
    announced = 0;
    inFight = false;
    capture = frameCapture();

    sessions.open({
      sessionId: SESSION,
      accountId: ACCOUNT,
      remoteAddr: "127.0.0.1",
    } as never);
    sessions.attachCharacter(SESSION, CHARACTER);

    const flow = {
      announceContents: async () => {
        announced += 1;
      },
    } as unknown as StorageFlow;

    const fights = {
      isInFight: () => inFight,
    } as unknown as FightRegistryService;

    service = new ExchangeService(
      registry,
      new ExchangeSerializer(),
      new ExchangeFramesService(capture.gateway),
      flow,
      noTrades(),
      noBigStore(),
      fights,
      sessions
    );
  });

  async function open() {
    return await service.openStorage(
      SESSION,
      ACCOUNT,
      CHARACTER,
      bankOwner(ACCOUNT),
      ExchangeType.EXCHANGE_STORAGE
    );
  }

  test("opening registers the session and announces the contents", async () => {
    const result = await open();

    expect(result.ok).toBe(true);
    expect(announced).toBe(1);
    expect(registry.get(SESSION)?.remote).toEqual({
      kind: OwnerKind.Bank,
      id: ACCOUNT,
    });
  });

  test("a second open on the same session is refused", async () => {
    await open();
    const second = await open();

    expect(second).toEqual({ ok: false, reason: "already-exchanging" });
    // The client says the same thing from its side with `EREO`, so the
    // refusal has to reach it rather than being swallowed.
    expect(capture.cases()).toContain("exchangeCreate");
    expect(announced).toBe(1);
  });

  test("a player in a fight cannot open one", async () => {
    inFight = true;

    expect(await open()).toEqual({ ok: false, reason: "in-fight" });
    expect(registry.has(SESSION)).toBe(false);
  });

  test("a session with no character cannot open one", async () => {
    const other = "s-2";
    sessions.open({
      sessionId: other,
      accountId: ACCOUNT,
      remoteAddr: "127.0.0.1",
    } as never);

    const result = await service.openStorage(
      other,
      ACCOUNT,
      CHARACTER,
      bankOwner(ACCOUNT),
      ExchangeType.EXCHANGE_STORAGE
    );

    expect(result).toEqual({ ok: false, reason: "not-in-world" });
  });

  test("leaving releases the lock and tells the client", async () => {
    await open();
    capture.sent.length = 0;

    service.leave(SESSION, "left");

    expect(registry.has(SESSION)).toBe(false);
    expect(capture.cases()).toEqual(["exchangeLeave"]);
    expect((await open()).ok).toBe(true);
  });

  test("a dropped socket releases the lock without an EV", async () => {
    await open();
    capture.sent.length = 0;

    service.leave(SESSION, "disconnected");

    expect(registry.has(SESSION)).toBe(false);
    // Nobody is listening, and the client clears its own exchange state
    // on close.
    expect(capture.sent).toEqual([]);
  });

  test("leaving twice is harmless", async () => {
    await open();
    service.leave(SESSION, "left");
    capture.sent.length = 0;

    service.leave(SESSION, "left");

    expect(capture.sent).toEqual([]);
  });

  test("a move on a closed session does nothing", async () => {
    const result = await service.moveItem(SESSION, true, "1", 1);

    expect(result).toEqual({ ok: false, reason: "no-session" });
  });

  describe("session serialisation", () => {
    test("two moves fired without awaiting do not interleave", async () => {
      await open();

      const events: string[] = [];
      let resolveFirst: (() => void) | undefined;

      const flow = {
        moveItem: async (_s: ExchangeSession, _to: boolean, id: string) => {
          events.push(`start:${id}`);

          if (id === "1") {
            await new Promise<void>((resolve) => {
              resolveFirst = resolve;
            });
          }

          events.push(`end:${id}`);
          return { ok: true as const };
        },
      } as unknown as StorageFlow;

      // Rebuild the service around the slow flow, keeping the registry
      // so the session opened above is still there.
      service = new ExchangeService(
        registry,
        new ExchangeSerializer(),
        new ExchangeFramesService(capture.gateway),
        flow,
        noTrades(),
        noBigStore(),
        { isInFight: () => false } as unknown as FightRegistryService,
        sessions
      );

      // This is the double-click: two frames dispatched without an
      // await between them, which is exactly how `WsRouter.dispatch` is
      // called from `GatewayFrameService.onFrame`.
      const first = service.moveItem(SESSION, true, "1", 1);
      const second = service.moveItem(SESSION, true, "2", 1);

      await Promise.resolve();
      expect(events).toEqual(["start:1"]);

      resolveFirst?.();
      await Promise.all([first, second]);

      expect(events).toEqual(["start:1", "end:1", "start:2", "end:2"]);
    });

    test("a failing operation does not wedge the queue", async () => {
      await open();

      let calls = 0;

      const flow = {
        moveItem: async () => {
          calls += 1;

          if (calls === 1) {
            throw new Error("boom");
          }

          return { ok: true as const };
        },
      } as unknown as StorageFlow;

      service = new ExchangeService(
        registry,
        new ExchangeSerializer(),
        new ExchangeFramesService(capture.gateway),
        flow,
        noTrades(),
        noBigStore(),
        { isInFight: () => false } as unknown as FightRegistryService,
        sessions
      );

      await expect(service.moveItem(SESSION, true, "1", 1)).rejects.toThrow(
        "boom"
      );
      expect(await service.moveItem(SESSION, true, "2", 1)).toEqual({
        ok: true,
      });
    });
  });

  describe("surviving a core restart", () => {
    test("a session whose socket came back is kept", async () => {
      await open();

      const snapshot = registry.serialize();
      const fresh = new ExchangeRegistryService(sessions);
      fresh.restore(snapshot);

      expect(fresh.get(SESSION)?.characterId).toBe(CHARACTER);
    });

    test("a session whose socket did not come back is dropped", async () => {
      await open();
      sessions.close(SESSION, "gone");

      // What the handoff coordinator calls once every part has been
      // restored.
      registry.onResume();

      expect(registry.has(SESSION)).toBe(false);
    });
  });
});
