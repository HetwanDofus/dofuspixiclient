import { ChatChannel } from "@dofus/proto/common_pb";

// The 1.29 wire symbols, transcribed from the decompiled client at
// assets/sources/client-code/dofus/aks/Chat.as. A `BM` frame's destination is
// either one of these letters or, when it is none of them, a player name — that
// is how retail encodes a whisper.
const CHANNEL_BY_LETTER: Readonly<Record<string, ChatChannel>> = {
  "*": ChatChannel.GENERAL,
  "#": ChatChannel.TEAM,
  $: ChatChannel.PARTY,
  "%": ChatChannel.GUILD,
  "!": ChatChannel.ALIGNMENT,
  "?": ChatChannel.RECRUITMENT,
  ":": ChatChannel.TRADE,
  "^": ChatChannel.DATING,
  "@": ChatChannel.ADMIN,
  i: ChatChannel.ADVICE,
  e: ChatChannel.EVENT,
};

/** Retail caps a chat line at 200 characters (dofus/Constants.as:147). */
export const MAX_MESSAGE_LENGTH = 200;

export type ChatDestination =
  | { kind: "channel"; channel: ChatChannel }
  | { kind: "whisper"; targetName: string };

/**
 * A destination is a single channel letter, or else the whole string is the
 * name of the player to whisper. An empty destination means the client sent no
 * prefix at all, which retail treats as the general channel.
 */
export function parseDestination(destination: string): ChatDestination {
  if (destination.length === 0) {
    return { kind: "channel", channel: ChatChannel.GENERAL };
  }

  if (destination.length === 1) {
    const channel = CHANNEL_BY_LETTER[destination];

    if (channel !== undefined) {
      return { kind: "channel", channel };
    }
  }

  return { kind: "whisper", targetName: destination };
}
