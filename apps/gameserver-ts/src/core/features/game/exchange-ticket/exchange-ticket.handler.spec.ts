import "reflect-metadata";

import { beforeEach, describe, expect, test } from "bun:test";

import type { ExchangeTicketRepository } from "@features/game/exchange-ticket/exchange-ticket.repository";
import type { ConfigService } from "@nestjs/config";
import type { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";
import { create } from "@bufbuild/protobuf";
import { AccountSendTicketSchema } from "@dofus/proto/account_pb";
import { ExchangeTicketHandler } from "@features/game/exchange-ticket/exchange-ticket.handler";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { SessionEvictionService } from "@shared/gateway-adapter/session-eviction.service";
import { SessionRegistry } from "@shared/gateway-adapter/session-registry";

// This is the eviction that matters: the in-game session is replaced here, not
// at login. A second window pivots to gamed and redeems its own fresh ticket.

const VALID = "good-ticket";

let registry: SessionRegistry;
let evicted: string[];
let handler: ExchangeTicketHandler;

beforeEach(() => {
  registry = new SessionRegistry(new EventEmitter2());
  evicted = [];

  const repo = {
    redeem: async (ticket: string) =>
      ticket === VALID ? { accountId: "acc-1" } : undefined,
  } as unknown as ExchangeTicketRepository;

  const frames = {
    broadcast: () => undefined,
    closeSession: (sessionId: string) => evicted.push(sessionId),
  } as unknown as GatewayFrameService;

  const config = { get: () => 1 } as unknown as ConfigService<never, true>;

  handler = new ExchangeTicketHandler(
    config,
    repo,
    registry,
    frames,
    new SessionEvictionService(registry, frames)
  );
});

function openSession(sessionId: string): void {
  registry.open({
    sessionId,
    accountId: "",
    characterId: "",
    remoteAddr: "10.0.0.1",
  });
}

const ticket = (raw: string) =>
  create(AccountSendTicketSchema, { ticket: raw });

describe("ExchangeTicketHandler — one session per account", () => {
  test("redeeming a ticket replaces the session already in game", async () => {
    openSession("in-game");
    registry.attachAccount("in-game", "acc-1");
    openSession("second-window");

    await handler.handle({ sessionId: "second-window" }, ticket(VALID));

    expect(evicted).toEqual(["in-game"]);
    expect(registry.get("in-game")).toBeUndefined();
    expect(registry.get("second-window")?.accountId).toBe("acc-1");
  });

  test("a rejected ticket evicts nobody", async () => {
    openSession("in-game");
    registry.attachAccount("in-game", "acc-1");
    openSession("forged");

    await handler.handle(
      { sessionId: "forged" },
      ticket("expired-or-replayed")
    );

    expect(evicted).toEqual([]);
    expect(registry.get("in-game")).toBeDefined();
    expect(registry.get("forged")?.accountId).toBe("");
  });
});
