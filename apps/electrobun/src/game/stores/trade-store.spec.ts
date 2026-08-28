import { beforeEach, describe, expect, test } from "bun:test";

import type { ItemData } from "@/game/network/protocol";

import {
  applyTradeItem,
  applyTradeKamas,
  applyTradeReady,
  closeTrade,
  getTradeItems,
  openTradeRequest,
  openTradeWindow,
  tradeStore,
} from "./trade-store";

const PARTNER = "42";

function item(unicId: number, quantity: number): ItemData {
  return {
    itemId: 39,
    unicId,
    quantity,
    position: -1,
    effects: [],
    effectsRaw: "",
  } as unknown as ItemData;
}

function open() {
  openTradeRequest(true, PARTNER, "Madani");
  openTradeWindow();
}

describe("tradeStore phases", () => {
  beforeEach(() => {
    closeTrade();
  });

  test("the initiator waits, the target is asked — same frame", () => {
    openTradeRequest(true, PARTNER, "Madani");
    expect(tradeStore.getSnapshot().phase).toBe("awaiting-answer");

    closeTrade();
    openTradeRequest(false, PARTNER, "Madani");
    expect(tradeStore.getSnapshot().phase).toBe("asked");
  });

  test("EC opens both offers empty", () => {
    open();

    const state = tradeStore.getSnapshot();
    expect(state.phase).toBe("open");
    expect(getTradeItems(state.mine)).toEqual([]);
    expect(getTradeItems(state.theirs)).toEqual([]);
    expect(state.partnerName).toBe("Madani");
  });

  test("an EC that arrives after the player walked away is ignored", () => {
    openTradeRequest(true, PARTNER, "Madani");
    closeTrade();

    openTradeWindow();

    expect(tradeStore.getSnapshot().phase).toBe("idle");
  });

  test("a movement outside an open window is ignored", () => {
    applyTradeItem("mine", true, item(10, 3));

    expect(getTradeItems(tradeStore.getSnapshot().mine)).toEqual([]);
  });
});

describe("tradeStore offers", () => {
  beforeEach(() => {
    closeTrade();
    open();
  });

  test("quantity is absolute, so a second frame replaces the first", () => {
    applyTradeItem("mine", true, item(10, 3));
    applyTradeItem("mine", true, item(10, 7));

    expect(getTradeItems(tradeStore.getSnapshot().mine)).toEqual([item(10, 7)]);
  });

  test("a removal only needs the id", () => {
    applyTradeItem("theirs", true, item(20, 2));
    applyTradeItem("theirs", false, item(20, 0));

    expect(getTradeItems(tradeStore.getSnapshot().theirs)).toEqual([]);
  });

  test("the two offers are independent", () => {
    applyTradeItem("mine", true, item(10, 1));
    applyTradeItem("theirs", true, item(20, 1));
    applyTradeKamas("theirs", 500);

    const state = tradeStore.getSnapshot();
    expect(getTradeItems(state.mine)).toEqual([item(10, 1)]);
    expect(state.mine.kamas).toBe(0);
    expect(state.theirs.kamas).toBe(500);
  });

  test("any change restamps the validate delay", () => {
    const before = tradeStore.getSnapshot().changedAt;

    applyTradeItem("theirs", true, item(20, 1));

    // Canonical `ui/Exchange.as` disables the button for three seconds
    // after *either* offer moves — it is the whole anti-scam measure,
    // and it has to restart on the other player's change too.
    expect(tradeStore.getSnapshot().changedAt).toBeGreaterThan(before);
  });

  test("a validation does not restamp it", () => {
    applyTradeItem("mine", true, item(10, 1));
    const stamped = tradeStore.getSnapshot().changedAt;

    applyTradeReady("theirs", true);

    // Otherwise two players validating at once would keep pushing the
    // button out of reach of each other.
    expect(tradeStore.getSnapshot().changedAt).toBe(stamped);
    expect(tradeStore.getSnapshot().theirs.ready).toBe(true);
  });
});
