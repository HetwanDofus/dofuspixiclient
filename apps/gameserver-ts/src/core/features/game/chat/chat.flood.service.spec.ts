import { beforeEach, describe, expect, test } from "bun:test";

import { ChatChannel } from "@dofus/proto/common_pb";
import { ChatFloodService } from "@features/game/chat/chat.flood.service";

// Trade is throttled to two minutes, recruitment to one; the map channels are
// not throttled at all. The interesting cases are the boundaries, because the
// remaining time is what the client puts in front of the player.

const T0 = 1_700_000_000_000;

let flood: ChatFloodService;

beforeEach(() => {
  flood = new ChatFloodService();
});

describe("untracked channels", () => {
  test("general never waits", () => {
    flood.commit("c-1", ChatChannel.GENERAL, T0);

    expect(flood.check("c-1", ChatChannel.GENERAL, T0)).toBe(0);
  });
});

describe("trade — two minutes", () => {
  test("the first message is free", () => {
    expect(flood.check("c-1", ChatChannel.TRADE, T0)).toBe(0);
  });

  test("a second message immediately after waits the full delay", () => {
    flood.commit("c-1", ChatChannel.TRADE, T0);

    expect(flood.check("c-1", ChatChannel.TRADE, T0)).toBe(120);
  });

  test("the remaining time is rounded up to the next whole second", () => {
    flood.commit("c-1", ChatChannel.TRADE, T0);

    expect(flood.check("c-1", ChatChannel.TRADE, T0 + 119_500)).toBe(1);
  });

  test("it clears exactly on the boundary", () => {
    flood.commit("c-1", ChatChannel.TRADE, T0);

    expect(flood.check("c-1", ChatChannel.TRADE, T0 + 120_000)).toBe(0);
  });
});

describe("isolation", () => {
  test("recruitment and trade are counted separately", () => {
    flood.commit("c-1", ChatChannel.TRADE, T0);

    expect(flood.check("c-1", ChatChannel.RECRUITMENT, T0)).toBe(0);
  });

  test("one player's cooldown does not touch another's", () => {
    flood.commit("c-1", ChatChannel.TRADE, T0);

    expect(flood.check("c-2", ChatChannel.TRADE, T0)).toBe(0);
  });
});

describe("memory", () => {
  test("stale entries are swept once the table grows, live ones are kept", () => {
    for (let i = 0; i < 600; i++) {
      flood.commit(`stale-${i}`, ChatChannel.TRADE, T0);
    }

    // Long past every cooldown: the sweep runs on the next commit.
    const later = T0 + 10 * 60_000;
    flood.commit("c-fresh", ChatChannel.TRADE, later);

    expect(flood.serialize()).toEqual([
      { characterId: "c-fresh", channel: ChatChannel.TRADE, lastSentAt: later },
    ]);
    expect(flood.check("c-fresh", ChatChannel.TRADE, later)).toBe(120);
  });
});

describe("handoff", () => {
  test("cooldowns survive a serialize/restore round trip", () => {
    flood.commit("c-1", ChatChannel.TRADE, T0);
    flood.commit("c-2", ChatChannel.RECRUITMENT, T0);

    const restored = new ChatFloodService();
    restored.restore(flood.serialize());

    expect(restored.check("c-1", ChatChannel.TRADE, T0 + 1000)).toBe(119);
    expect(restored.check("c-2", ChatChannel.RECRUITMENT, T0 + 1000)).toBe(59);
  });
});
