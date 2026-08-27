import { beforeEach, describe, expect, test } from "bun:test";

import type {
  ChatAuthor,
  ChatTargetPorts,
} from "@features/game/chat/chat.targets";
import { ChatErrorReason } from "@dofus/proto/chat_pb";
import { ChatChannel } from "@dofus/proto/common_pb";
import { parseDestination } from "@features/game/chat/chat.channels";
import { resolveRouting } from "@features/game/chat/chat.targets";

// The routing table is the whole feature: which channel reaches whom. Everything
// else in the slice is plumbing around this function.

const AUTHOR: ChatAuthor = {
  sessionId: "s-author",
  characterId: "c-author",
  name: "Mikos",
  mapId: 7411,
};

let ports: ChatTargetPorts;
let inFight: boolean;

beforeEach(() => {
  inFight = false;

  ports = {
    sessionsOnMap: () => ["s-author", "s-neighbour"],
    allSessions: () => ["s-author", "s-neighbour", "s-faraway"],
    getByName: (name) =>
      name.toLowerCase() === "elyne"
        ? { sessionId: "s-elyne", name: "Elyne" }
        : undefined,
    teamSessions: () => (inFight ? ["s-author", "s-ally"] : undefined),
  };
});

function route(destination: string) {
  return resolveRouting(parseDestination(destination), AUTHOR, ports);
}

describe("map-scoped channels", () => {
  test("general reaches the map, author included so it echoes", () => {
    const result = route("*");

    expect(result).toEqual({
      ok: true,
      delivery: {
        kind: "broadcast",
        channel: ChatChannel.GENERAL,
        targets: ["s-author", "s-neighbour"],
      },
    });
  });

  test("an empty destination is the general channel", () => {
    const result = route("");

    expect(result.ok && result.delivery.kind === "broadcast").toBe(true);
    expect(
      result.ok &&
        result.delivery.kind === "broadcast" &&
        result.delivery.channel
    ).toBe(ChatChannel.GENERAL);
  });
});

describe("server-wide channels", () => {
  test.each([
    [":", ChatChannel.TRADE],
    ["?", ChatChannel.RECRUITMENT],
    ["!", ChatChannel.ALIGNMENT],
  ])("%s reaches every online session", (letter, channel) => {
    expect(route(letter)).toEqual({
      ok: true,
      delivery: {
        kind: "broadcast",
        channel,
        targets: ["s-author", "s-neighbour", "s-faraway"],
      },
    });
  });
});

describe("team channel", () => {
  test("reaches allies while fighting", () => {
    inFight = true;

    expect(route("#")).toEqual({
      ok: true,
      delivery: {
        kind: "broadcast",
        channel: ChatChannel.TEAM,
        targets: ["s-author", "s-ally"],
      },
    });
  });

  test("is refused outside a fight", () => {
    expect(route("#")).toEqual({
      ok: false,
      reason: ChatErrorReason.NOT_IN_FIGHT,
    });
  });
});

describe("channels with no domain behind them", () => {
  test("guild is refused", () => {
    expect(route("%")).toEqual({ ok: false, reason: ChatErrorReason.NO_GUILD });
  });

  test("party is refused", () => {
    expect(route("$")).toEqual({ ok: false, reason: ChatErrorReason.NO_PARTY });
  });
});

describe("whisper", () => {
  test("a destination that is not a channel letter is a player name", () => {
    expect(route("Elyne")).toEqual({
      ok: true,
      delivery: {
        kind: "whisper",
        targetSessionId: "s-elyne",
        targetName: "Elyne",
      },
    });
  });

  test("the lookup is case-insensitive but echoes the canonical casing", () => {
    const result = route("elYNE");

    expect(
      result.ok &&
        result.delivery.kind === "whisper" &&
        result.delivery.targetName
    ).toBe("Elyne");
  });

  test("an offline or unknown name reports the name back", () => {
    expect(route("Inconnu")).toEqual({
      ok: false,
      reason: ChatErrorReason.PLAYER_NOT_FOUND,
      detail: "Inconnu",
    });
  });

  test("whispering yourself is refused", () => {
    ports.getByName = () => ({
      sessionId: AUTHOR.sessionId,
      name: AUTHOR.name,
    });

    expect(route("Mikos")).toEqual({
      ok: false,
      reason: ChatErrorReason.CANT_WISP_YOURSELF,
    });
  });
});
