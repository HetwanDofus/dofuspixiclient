import { describe, expect, test } from "bun:test";

import { ChatChannel } from "@dofus/proto/common_pb";
import { parseDestination } from "@features/game/chat/chat.channels";

// The letters come from the decompiled 1.29 client; $ is the party and % the
// guild, which is the pair the previous mapping had swapped.

describe("parseDestination", () => {
  test.each([
    ["*", ChatChannel.GENERAL],
    ["#", ChatChannel.TEAM],
    ["$", ChatChannel.PARTY],
    ["%", ChatChannel.GUILD],
    ["!", ChatChannel.ALIGNMENT],
    ["?", ChatChannel.RECRUITMENT],
    [":", ChatChannel.TRADE],
    ["^", ChatChannel.DATING],
    ["@", ChatChannel.ADMIN],
    ["i", ChatChannel.ADVICE],
    ["e", ChatChannel.EVENT],
  ])("%s is a channel letter", (letter, channel) => {
    expect(parseDestination(letter)).toEqual({ kind: "channel", channel });
  });

  test("an empty destination falls back to the general channel", () => {
    expect(parseDestination("")).toEqual({
      kind: "channel",
      channel: ChatChannel.GENERAL,
    });
  });

  test("anything else is the name of a player to whisper", () => {
    expect(parseDestination("Elyne")).toEqual({
      kind: "whisper",
      targetName: "Elyne",
    });
  });

  test("a single unknown character is a one-letter player name, not a channel", () => {
    expect(parseDestination("z")).toEqual({
      kind: "whisper",
      targetName: "z",
    });
  });
});
