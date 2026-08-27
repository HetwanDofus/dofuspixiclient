import { describe, expect, test } from "bun:test";

import { ChatChannel } from "@dofus/proto/common_pb";

import { parseChatInput } from "@/game/chat/chat-commands";

// The parser is the whole contract between what a player types and what goes on
// the wire, so it is worth pinning letter by letter.

describe("plain text", () => {
  test("goes to the active channel with that channel's letter", () => {
    expect(parseChatInput("bonjour", ChatChannel.GENERAL)).toEqual({
      kind: "send",
      channel: ChatChannel.GENERAL,
      destination: "*",
      message: "bonjour",
    });
  });

  test("follows the star button to another channel", () => {
    expect(parseChatInput("vends chapeau", ChatChannel.TRADE)).toEqual({
      kind: "send",
      channel: ChatChannel.TRADE,
      destination: ":",
      message: "vends chapeau",
    });
  });

  test("is truncated at the retail 200-character cap", () => {
    const result = parseChatInput("a".repeat(250), ChatChannel.GENERAL);

    expect(result.kind === "send" && result.message.length).toBe(200);
  });

  test("a blank line is swallowed", () => {
    expect(parseChatInput("   ", ChatChannel.GENERAL)).toEqual({
      kind: "noop",
    });
  });
});

describe("channel commands", () => {
  test.each([
    ["/s salut", ChatChannel.GENERAL, "*"],
    ["/t on focus", ChatChannel.TEAM, "#"],
    ["/p on y va", ChatChannel.PARTY, "$"],
    ["/g coucou", ChatChannel.GUILD, "%"],
    ["/a defense", ChatChannel.ALIGNMENT, "!"],
    ["/r cherche dj", ChatChannel.RECRUITMENT, "?"],
    ["/b vends chapeau", ChatChannel.TRADE, ":"],
  ])("%s", (input, channel, destination) => {
    const result = parseChatInput(input, ChatChannel.GENERAL);

    expect(result.kind === "send" && result.channel).toBe(channel);
    expect(result.kind === "send" && result.destination).toBe(destination);
  });

  test("the French aliases work too", () => {
    expect(parseChatInput("/commerce vends", ChatChannel.GENERAL)).toEqual({
      kind: "send",
      channel: ChatChannel.TRADE,
      destination: ":",
      message: "vends",
    });
  });

  test("commands are case-insensitive", () => {
    const result = parseChatInput("/B vends", ChatChannel.GENERAL);

    expect(result.kind === "send" && result.channel).toBe(ChatChannel.TRADE);
  });

  test("a command overrides the active channel for one message only", () => {
    const result = parseChatInput("/b vends", ChatChannel.GENERAL);

    expect(result.kind === "send" && result.channel).toBe(ChatChannel.TRADE);
    // Nothing here mutates the active channel — the caller keeps passing its own.
    expect(parseChatInput("suite", ChatChannel.GENERAL)).toEqual({
      kind: "send",
      channel: ChatChannel.GENERAL,
      destination: "*",
      message: "suite",
    });
  });

  test("a command with no message says nothing", () => {
    expect(parseChatInput("/b", ChatChannel.GENERAL)).toEqual({ kind: "noop" });
  });

  test("an unknown command reports a syntax error and sends nothing", () => {
    const result = parseChatInput("/zorglub hello", ChatChannel.GENERAL);

    expect(result.kind).toBe("error");
  });
});

describe("whisper", () => {
  test.each(["/w", "/msg", "/whisper"])(
    "%s <nom> <message> targets the name",
    (command) => {
      expect(
        parseChatInput(`${command} Elyne salut`, ChatChannel.GENERAL)
      ).toEqual({
        kind: "send",
        channel: ChatChannel.WHISPER_TO,
        destination: "Elyne",
        message: "salut",
      });
    }
  );

  test("keeps the whole rest of the line as the message", () => {
    const result = parseChatInput(
      "/w Elyne salut ça va ?",
      ChatChannel.GENERAL
    );

    expect(result.kind === "send" && result.message).toBe("salut ça va ?");
  });

  test("a missing message is a syntax error", () => {
    expect(parseChatInput("/w Elyne", ChatChannel.GENERAL).kind).toBe("error");
  });

  test("a one-letter target is a syntax error, as in retail", () => {
    expect(parseChatInput("/w E salut", ChatChannel.GENERAL).kind).toBe(
      "error"
    );
  });
});
