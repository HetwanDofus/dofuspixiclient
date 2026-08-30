import "reflect-metadata";

import { beforeEach, describe, expect, test } from "bun:test";

import type { DofusMessage } from "@dofus/proto/server_messages_pb";
import type { ExchangeSession } from "@modules/exchange/exchange.types";
import type { FightRegistryService } from "@modules/fight/registry/fight.registry";
import type { InventoryFramesService } from "@modules/inventory/inventory.frames.service";
import type { ItemTransferService } from "@modules/items/item-transfer.service";
import type { ItemsRepository } from "@modules/items/items.repository";
import type { KamasTransferService } from "@modules/items/kamas-transfer.service";
import type { PlayerPresenceService } from "@modules/player-presence/player-presence.service";
import type { PlayersRepository } from "@modules/players/players.repository";
import type { StatsService } from "@modules/stats/stats.service";
import type { ItemRow } from "@shared/db/schema";
import type { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";
import { ExchangeFramesService } from "@modules/exchange/exchange.frames.service";
import { ExchangeRegistryService } from "@modules/exchange/exchange.registry";
import { TradeFlow } from "@modules/exchange/trade.flow";
import { TradeRegistryService } from "@modules/exchange/trade.registry";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { SessionRegistry } from "@shared/gateway-adapter/session-registry";

const A = { session: "s-a", character: "1", account: "acc-a", name: "Kameto" };
const B = { session: "s-b", character: "2", account: "acc-b", name: "Madani" };
/** A bystander, for the "already exchanging" case. */
const C = { session: "s-c", character: "3", account: "acc-c", name: "Tobie" };

const MAP = 7411;

function itemRow(id: string, owner: string, quantity: number): ItemRow {
  return {
    id,
    ownerKind: 1,
    ownerId: owner,
    templateId: 303,
    quantity,
    effects: [],
    position: -1,
    effectsHash: "h",
  } as unknown as ItemRow;
}

interface Harness {
  flow: TradeFlow;
  trades: TradeRegistryService;
  exchanges: ExchangeRegistryService;
  sessions: SessionRegistry;
  sent: { to: readonly string[]; msg: DofusMessage }[];
  casesFor: (sessionId: string) => (string | undefined)[];
  transfers: { itemId: string; quantity: number; from: string; to: string }[];
  kamasMoves: { amount: bigint; from: string; to: string }[];
  session: (who: typeof A) => ExchangeSession;
  setMap: (who: typeof A, mapId: number) => void;
  failTransfer: (itemId: string) => void;
}

function harness(
  options: { stacks?: ItemRow[]; purse?: number } = {}
): Harness {
  const sent: { to: readonly string[]; msg: DofusMessage }[] = [];
  const transfers: Harness["transfers"] = [];
  const kamasMoves: Harness["kamasMoves"] = [];
  const failing = new Set<string>();
  const maps = new Map<string, number>([
    [A.character, MAP],
    [B.character, MAP],
    [C.character, MAP],
  ]);

  const stacks = options.stacks ?? [
    itemRow("10", A.character, 8),
    itemRow("20", B.character, 3),
  ];

  const gateway = {
    broadcast: (to: readonly string[], msg: DofusMessage) => {
      sent.push({ to: [...to], msg });
    },
  } as unknown as GatewayFrameService;

  const sessions = new SessionRegistry(new EventEmitter2());

  for (const who of [A, B, C]) {
    sessions.open({
      sessionId: who.session,
      accountId: who.account,
      remoteAddr: "127.0.0.1",
    } as never);
    sessions.attachCharacter(who.session, who.character);
  }

  const frames = new ExchangeFramesService(gateway);
  const exchanges = new ExchangeRegistryService(sessions);
  const trades = new TradeRegistryService(sessions, exchanges, frames);

  const presence = {
    getByCharacter: (characterId: string) => {
      const mapId = maps.get(characterId);
      const who = [A, B, C].find((w) => w.character === characterId);

      return mapId === undefined || !who
        ? undefined
        : { sessionId: who.session, mapId, name: who.name };
    },
  } as unknown as PlayerPresenceService;

  const items = {
    findOwned: async (owner: { id: string }, itemId: string) =>
      stacks.find((s) => s.id === itemId && s.ownerId === owner.id),
  } as unknown as ItemsRepository;

  const itemTransfers = {
    transfer: async (cmd: {
      itemId: string;
      quantity: number;
      from: { id: string };
      to: { id: string };
    }) => {
      if (failing.has(cmd.itemId)) {
        return { ok: false as const, reason: "not-enough" };
      }

      transfers.push({
        itemId: cmd.itemId,
        quantity: cmd.quantity,
        from: cmd.from.id,
        to: cmd.to.id,
      });

      const source = stacks.find((s) => s.id === cmd.itemId) as ItemRow;

      return {
        ok: true as const,
        move: {
          source,
          quantity: cmd.quantity,
          sourceRemaining: source.quantity - cmd.quantity,
          destination: itemRow(`${cmd.itemId}-new`, cmd.to.id, cmd.quantity),
          keptIdentity: false,
        },
      };
    },
  } as unknown as ItemTransferService;

  const kamas = {
    transfer: async (cmd: {
      amount: bigint;
      from: { id: string };
      to: { id: string };
    }) => {
      kamasMoves.push({
        amount: cmd.amount,
        from: cmd.from.id,
        to: cmd.to.id,
      });
      return { ok: true as const };
    },
  } as unknown as KamasTransferService;

  const players = {
    findById: async () => ({ kamas: options.purse ?? 1000 }),
  } as unknown as PlayersRepository;

  const flow = new TradeFlow(
    // `withTransaction` runs inline: nothing under test depends on
    // rollback, only on the fact that a refusal stops the loop.
    { withTransaction: <T>(fn: () => Promise<T>) => fn() } as never,
    trades,
    exchanges,
    frames,
    presence,
    sessions,
    { isInFight: () => false } as unknown as FightRegistryService,
    items,
    itemTransfers,
    kamas,
    players,
    {
      sendItemAdd: () => {},
      sendItemQuantity: () => {},
      sendItemRemove: () => {},
      sendTemplateFor: async () => {},
    } as unknown as InventoryFramesService,
    { sendStats: async () => {} } as unknown as StatsService
  );

  return {
    flow,
    trades,
    exchanges,
    sessions,
    sent,
    transfers,
    kamasMoves,
    casesFor: (sessionId) =>
      sent
        .filter((f) => f.to.includes(sessionId))
        .map((f) => f.msg.payload.case),
    session: (who) => exchanges.get(who.session) as ExchangeSession,
    setMap: (who, mapId) => {
      maps.set(who.character, mapId);
    },
    failTransfer: (itemId) => {
      failing.add(itemId);
    },
  };
}

function request(h: Harness) {
  return h.flow.request(
    {
      sessionId: A.session,
      accountId: A.account,
      characterId: A.character,
    },
    B.character
  );
}

async function opened(h: Harness) {
  request(h);
  h.flow.accept(h.session(B));
  h.sent.length = 0;
}

describe("TradeFlow.request", () => {
  let h: Harness;

  beforeEach(() => {
    h = harness();
  });

  test("occupies both players before anyone has accepted", () => {
    expect(request(h).ok).toBe(true);

    // The point of creating both sessions at request time: a third
    // player asking either of them is refused by the ordinary occupancy
    // lock, with no extra bookkeeping.
    expect(h.exchanges.has(A.session)).toBe(true);
    expect(h.exchanges.has(B.session)).toBe(true);
    expect(h.session(A).phase).toBe("pending");
    expect(h.session(B).phase).toBe("pending");
  });

  test("both halves share one serializer queue", () => {
    request(h);

    // The deadlock-free answer to "two sessions to lock together":
    // there are not two locks to order, there is one queue.
    expect(h.session(A).lockKey).toBe(h.session(B).lockKey);
    expect(h.session(A).lockKey).toBe(h.session(A).tradeId as string);
  });

  test("ER goes to both players", () => {
    request(h);

    expect(h.casesFor(A.session)).toEqual(["exchangeRequest"]);
    expect(h.casesFor(B.session)).toEqual(["exchangeRequest"]);
  });

  test("refuses a trade with oneself", () => {
    const result = h.flow.request(
      {
        sessionId: A.session,
        accountId: A.account,
        characterId: A.character,
      },
      A.character
    );

    expect(result).toEqual({ ok: false, reason: "self" });
  });

  test("refuses a player on another map", () => {
    h.setMap(B, 7412);

    expect(request(h)).toEqual({ ok: false, reason: "different-map" });
    expect(h.exchanges.has(A.session)).toBe(false);
  });

  test("refuses a player already exchanging", () => {
    request(h);

    const third = h.flow.request(
      {
        sessionId: C.session,
        accountId: C.account,
        characterId: C.character,
      },
      B.character
    );

    expect(third).toEqual({ ok: false, reason: "target-busy" });
  });
});

describe("TradeFlow.accept", () => {
  test("sends EC to both and never EL", async () => {
    const h = harness();
    request(h);
    h.sent.length = 0;

    expect(h.flow.accept(h.session(B)).ok).toBe(true);

    // `onCreate` case 1 builds its model from the client's own
    // inventory clone; an `EL` after this would be read as a storage
    // list and would corrupt the window.
    expect(h.casesFor(A.session)).toEqual(["exchangeCreate"]);
    expect(h.casesFor(B.session)).toEqual(["exchangeCreate"]);
    expect(h.session(A).phase).toBe("open");
  });

  test("the initiator cannot accept their own proposal", () => {
    const h = harness();
    request(h);

    expect(h.flow.accept(h.session(A))).toEqual({
      ok: false,
      reason: "not-target",
    });
  });

  test("a player who walked off in the meantime kills the proposal", () => {
    const h = harness();
    request(h);
    h.setMap(B, 7412);

    expect(h.flow.accept(h.session(B))).toEqual({
      ok: false,
      reason: "different-map",
    });
    expect(h.exchanges.has(A.session)).toBe(false);
    expect(h.exchanges.has(B.session)).toBe(false);
  });
});

describe("TradeFlow offers", () => {
  test("EM to the mover, Em to the watcher", async () => {
    const h = harness();
    await opened(h);

    expect((await h.flow.moveItem(h.session(A), true, "10", 3)).ok).toBe(true);

    expect(h.casesFor(A.session)).toEqual(["exchangeLocalMovement"]);
    expect(h.casesFor(B.session)).toEqual(["exchangeDistantMovement"]);
  });

  test("the quantity is the absolute size of the offer, not an increment", async () => {
    const h = harness();
    await opened(h);

    await h.flow.moveItem(h.session(A), true, "10", 3);
    await h.flow.moveItem(h.session(A), true, "10", 5);

    const trade = h.trades.get(h.session(A).tradeId as string);
    expect(trade?.initiator.offer).toEqual({ "10": 5 });
  });

  test("refuses more than the stack holds", async () => {
    const h = harness();
    await opened(h);

    expect(await h.flow.moveItem(h.session(A), true, "10", 9)).toEqual({
      ok: false,
      reason: "not-enough",
    });
  });

  test("refuses a stack owned by the other player", async () => {
    const h = harness();
    await opened(h);

    expect(await h.flow.moveItem(h.session(A), true, "20", 1)).toEqual({
      ok: false,
      reason: "not-found",
    });
  });

  test("kamas are clamped to the purse rather than refused", async () => {
    const h = harness({ purse: 40 });
    await opened(h);

    await h.flow.moveKamas(h.session(A), 500n);

    const trade = h.trades.get(h.session(A).tradeId as string);
    expect(trade?.initiator.kamas).toBe("40");
  });

  test("nothing is written before both players validate", async () => {
    const h = harness();
    await opened(h);

    await h.flow.moveItem(h.session(A), true, "10", 3);
    await h.flow.moveKamas(h.session(A), 100n);
    await h.flow.setReady(h.session(A));

    expect(h.transfers).toEqual([]);
    expect(h.kamasMoves).toEqual([]);
  });
});

describe("TradeFlow validation", () => {
  test("a change after a validation clears it, on both sides", async () => {
    const h = harness();
    await opened(h);

    await h.flow.setReady(h.session(A));
    h.sent.length = 0;

    await h.flow.moveItem(h.session(B), true, "20", 1);

    const trade = h.trades.get(h.session(B).tradeId as string);

    // The scam this rule exists to stop: A validates, B swaps the offer,
    // and the deal closes on something A never agreed to. The client
    // will not do it — `updateLocalData` touches the button and never
    // the flags — so it has to happen here.
    expect(trade?.initiator.ready).toBe(false);
    expect(trade?.target.ready).toBe(false);
    // And it is announced: the client tints each pane from its own copy
    // of the flags, so clearing them in silence would leave a green
    // pane over a changed offer.
    expect(h.casesFor(A.session)).toContain("exchangeReady");
  });

  test("one validation alone commits nothing", async () => {
    const h = harness();
    await opened(h);

    await h.flow.moveItem(h.session(A), true, "10", 3);
    await h.flow.setReady(h.session(A));

    expect(h.transfers).toEqual([]);
    expect(h.exchanges.has(A.session)).toBe(true);
  });

  test("the second validation commits both offers and both purses", async () => {
    const h = harness();
    await opened(h);

    await h.flow.moveItem(h.session(A), true, "10", 3);
    await h.flow.moveKamas(h.session(A), 100n);
    await h.flow.moveItem(h.session(B), true, "20", 2);
    h.sent.length = 0;

    await h.flow.setReady(h.session(A));
    expect(await h.flow.setReady(h.session(B))).toEqual({ ok: true });

    expect(h.transfers).toEqual([
      { itemId: "10", quantity: 3, from: A.character, to: B.character },
      { itemId: "20", quantity: 2, from: B.character, to: A.character },
    ]);
    expect(h.kamasMoves).toEqual([
      { amount: 100n, from: A.character, to: B.character },
    ]);

    // `EV` with `completed` — the only thing that makes the client print
    // "Echange effectue" rather than "Echange annule".
    const leaves = h.sent.filter((f) => f.msg.payload.case === "exchangeLeave");
    expect(leaves).toHaveLength(2);
    for (const leave of leaves) {
      expect(
        (leave.msg.payload.value as { completed: boolean }).completed
      ).toBe(true);
    }

    expect(h.exchanges.has(A.session)).toBe(false);
    expect(h.exchanges.has(B.session)).toBe(false);
  });

  test("a refusal partway through cancels the whole trade", async () => {
    const h = harness();
    await opened(h);

    await h.flow.moveItem(h.session(A), true, "10", 3);
    await h.flow.moveItem(h.session(B), true, "20", 2);
    h.failTransfer("20");

    await h.flow.setReady(h.session(A));
    const result = await h.flow.setReady(h.session(B));

    expect(result).toEqual({ ok: false, reason: "commit-failed" });

    const leaves = h.sent.filter((f) => f.msg.payload.case === "exchangeLeave");
    expect(leaves).toHaveLength(2);
    for (const leave of leaves) {
      expect(
        (leave.msg.payload.value as { completed: boolean }).completed
      ).toBe(false);
    }
    expect(h.exchanges.has(A.session)).toBe(false);
  });

  test("a player who left the map before validating gets nothing", async () => {
    const h = harness();
    await opened(h);

    await h.flow.moveItem(h.session(A), true, "10", 3);
    await h.flow.setReady(h.session(A));
    h.setMap(B, 7412);

    expect(await h.flow.setReady(h.session(B))).toEqual({
      ok: false,
      reason: "different-map",
    });
    expect(h.transfers).toEqual([]);
  });
});
