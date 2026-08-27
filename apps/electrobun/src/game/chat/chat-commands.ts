import { ChatChannel } from "@dofus/proto/common_pb";

import { MAX_MESSAGE_LENGTH, styleFor } from "@/game/chat/chat-channels";

/**
 * Slash commands, transcribed from the decompiled client at
 * `assets/sources/client-code/dofus/utils/consoleParsers/ChatConsoleParser.as:142-199`.
 * The French aliases are ours — retail only had the single letters, but the
 * words are what players type.
 */
const COMMAND_CHANNELS: Readonly<Record<string, ChatChannel>> = {
  s: ChatChannel.GENERAL,
  say: ChatChannel.GENERAL,
  t: ChatChannel.TEAM,
  equipe: ChatChannel.TEAM,
  p: ChatChannel.PARTY,
  groupe: ChatChannel.PARTY,
  g: ChatChannel.GUILD,
  guilde: ChatChannel.GUILD,
  a: ChatChannel.ALIGNMENT,
  alignement: ChatChannel.ALIGNMENT,
  r: ChatChannel.RECRUITMENT,
  recrutement: ChatChannel.RECRUITMENT,
  b: ChatChannel.TRADE,
  commerce: ChatChannel.TRADE,
  i: ChatChannel.DATING,
  q: ChatChannel.ADMIN,
};

const WHISPER_COMMANDS = new Set(["w", "msg", "whisper"]);

/** `SYNTAX_ERROR` interpolated with the retail `/w <nom> <msg>` hint. */
const WHISPER_SYNTAX = "Erreur de syntaxe : /w <nom> <message>";

export interface ChatSend {
  kind: "send";
  /** Channel the message is charged and coloured against. */
  channel: ChatChannel;
  /** `ChatSendMessage.destination` — a channel letter, or a player name. */
  destination: string;
  message: string;
}

export interface ChatCommandError {
  kind: "error";
  text: string;
}

/** An empty or whitespace-only line: swallow it, say nothing. */
export interface ChatNoop {
  kind: "noop";
}

export type ChatInput = ChatSend | ChatCommandError | ChatNoop;

function unknownCommand(name: string): ChatCommandError {
  return { kind: "error", text: `Erreur de syntaxe : /${name} est inconnue.` };
}

/**
 * Turns what the player typed into what goes on the wire.
 *
 * Without a leading slash the message goes to `activeChannel` — whatever the
 * star button currently selects. A slash command overrides it for that one
 * message only, which is the retail behaviour: `/b` does not make trade sticky.
 */
export function parseChatInput(
  raw: string,
  activeChannel: ChatChannel
): ChatInput {
  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    return { kind: "noop" };
  }

  if (!trimmed.startsWith("/")) {
    return {
      kind: "send",
      channel: activeChannel,
      destination: styleFor(activeChannel).letter,
      message: trimmed.slice(0, MAX_MESSAGE_LENGTH),
    };
  }

  const spaceAt = trimmed.indexOf(" ");
  const name = (
    spaceAt === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceAt)
  ).toLowerCase();
  const rest = spaceAt === -1 ? "" : trimmed.slice(spaceAt + 1).trim();

  if (WHISPER_COMMANDS.has(name)) {
    const targetAt = rest.indexOf(" ");

    if (targetAt === -1) {
      return { kind: "error", text: WHISPER_SYNTAX };
    }

    const target = rest.slice(0, targetAt);
    const message = rest.slice(targetAt + 1).trim();

    if (target.length < 2 || message.length === 0) {
      return { kind: "error", text: WHISPER_SYNTAX };
    }

    return {
      kind: "send",
      channel: ChatChannel.WHISPER_TO,
      destination: target,
      message: message.slice(0, MAX_MESSAGE_LENGTH),
    };
  }

  const channel = COMMAND_CHANNELS[name];

  if (channel === undefined) {
    return unknownCommand(name);
  }

  if (rest.length === 0) {
    return { kind: "noop" };
  }

  return {
    kind: "send",
    channel,
    destination: styleFor(channel).letter,
    message: rest.slice(0, MAX_MESSAGE_LENGTH),
  };
}
