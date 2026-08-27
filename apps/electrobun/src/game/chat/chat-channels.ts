import { ChatChannel } from "@dofus/proto/common_pb";

import {
  SIDE_CHAT_CHANNEL,
  type SideChatChannel,
} from "@/components/ui/side-chat-panel.channels";

/**
 * A chat line carries two independent things, and conflating them is the bug
 * this module exists to prevent:
 *
 *  - the **channel** it was broadcast on (the 1.29 wire letter), which decides
 *    its colour and its `(Canal)` label;
 *  - the **filter bucket** (`ChatManager.TYPE_*`, 0-10), which decides whether
 *    the checkbox row is currently showing it.
 *
 * They are not one-to-one. The retail tooltip for bucket 3 says it outright —
 * "Affiche / Cache les messages privés, de groupe et d'équipe": three channels,
 * one checkbox, three different colours.
 *
 * Letters and colours are transcribed from the decompiled client under
 * `assets/sources/client-code` (`dofus/aks/Chat.as`, `dofus/Constants.as:146-173`);
 * labels from `public/assets/langs/fr/lang.json`.
 */
export interface ChatChannelStyle {
  /** Wire symbol sent as `ChatSendMessage.destination`. */
  letter: string;
  /** Filter checkbox this channel is hidden behind. */
  filter: SideChatChannel;
  /** CSS custom property reference, so the palette stays themable. */
  color: string;
  /** French label rendered as `(Guilde)` in front of the message. */
  label: string;
  /** Offered by the channel picker behind the star button. */
  selectable: boolean;
}

function color(name: string): string {
  return `var(--color-side-chat-channel-${name})`;
}

export const CHAT_CHANNEL_STYLES: Readonly<
  Record<ChatChannel, ChatChannelStyle>
> = {
  [ChatChannel.UNSPECIFIED]: {
    letter: "*",
    filter: SIDE_CHAT_CHANNEL.MESSAGES,
    color: color("messages"),
    label: "Général",
    selectable: false,
  },
  [ChatChannel.GENERAL]: {
    letter: "*",
    filter: SIDE_CHAT_CHANNEL.MESSAGES,
    color: color("messages"),
    label: "Général",
    selectable: true,
  },
  [ChatChannel.TEAM]: {
    letter: "#",
    filter: SIDE_CHAT_CHANNEL.WISP,
    color: color("group"),
    label: "Equipe",
    selectable: true,
  },
  [ChatChannel.PARTY]: {
    letter: "$",
    filter: SIDE_CHAT_CHANNEL.WISP,
    color: color("group"),
    label: "Groupe",
    selectable: true,
  },
  [ChatChannel.GUILD]: {
    letter: "%",
    filter: SIDE_CHAT_CHANNEL.GUILD,
    color: color("guild"),
    label: "Guilde",
    selectable: true,
  },
  [ChatChannel.ALIGNMENT]: {
    letter: "!",
    filter: SIDE_CHAT_CHANNEL.PVP,
    color: color("pvp"),
    label: "Alignement",
    selectable: true,
  },
  [ChatChannel.RECRUITMENT]: {
    letter: "?",
    filter: SIDE_CHAT_CHANNEL.RECRUITMENT,
    color: color("recruitment"),
    label: "Recrutement",
    selectable: true,
  },
  [ChatChannel.TRADE]: {
    letter: ":",
    filter: SIDE_CHAT_CHANNEL.TRADE,
    color: color("trade"),
    label: "Commerce",
    selectable: true,
  },
  // Deprecated on the wire — the retail alignment channel is ALIGNMENT. Kept so
  // the record stays exhaustive over the enum.
  [ChatChannel.PVP]: {
    letter: "!",
    filter: SIDE_CHAT_CHANNEL.PVP,
    color: color("pvp"),
    label: "Alignement",
    selectable: false,
  },
  [ChatChannel.ADVICE]: {
    letter: "i",
    filter: SIDE_CHAT_CHANNEL.INFOS,
    color: color("infos"),
    label: "Info",
    selectable: false,
  },
  [ChatChannel.DATING]: {
    letter: "^",
    filter: SIDE_CHAT_CHANNEL.MEETIC,
    color: color("meetic"),
    label: "Incarnam",
    selectable: false,
  },
  [ChatChannel.EVENT]: {
    letter: "e",
    filter: SIDE_CHAT_CHANNEL.GAME_EVENTS,
    color: color("game-events"),
    label: "Évènement",
    selectable: false,
  },
  [ChatChannel.WHISPER_FROM]: {
    letter: "F",
    filter: SIDE_CHAT_CHANNEL.WISP,
    color: color("whisper"),
    label: "de",
    selectable: false,
  },
  [ChatChannel.WHISPER_TO]: {
    letter: "T",
    filter: SIDE_CHAT_CHANNEL.WISP,
    color: color("whisper"),
    label: "à",
    selectable: false,
  },
  [ChatChannel.ADMIN]: {
    letter: "@",
    filter: SIDE_CHAT_CHANNEL.ADMIN,
    color: color("admin"),
    label: "Admin",
    selectable: false,
  },
};

/** Order of the star menu — the channels a player can actually pick. */
export const SELECTABLE_CHAT_CHANNELS: readonly ChatChannel[] = [
  ChatChannel.GENERAL,
  ChatChannel.TEAM,
  ChatChannel.PARTY,
  ChatChannel.GUILD,
  ChatChannel.ALIGNMENT,
  ChatChannel.RECRUITMENT,
  ChatChannel.TRADE,
];

const CHANNEL_BY_LETTER = new Map<string, ChatChannel>(
  SELECTABLE_CHAT_CHANNELS.map((channel) => [
    CHAT_CHANNEL_STYLES[channel].letter,
    channel,
  ])
);

export function channelFromLetter(letter: string): ChatChannel | undefined {
  return CHANNEL_BY_LETTER.get(letter);
}

export function styleFor(channel: ChatChannel): ChatChannelStyle {
  return (
    CHAT_CHANNEL_STYLES[channel] ?? CHAT_CHANNEL_STYLES[ChatChannel.GENERAL]
  );
}

/**
 * Per-channel send interval, mirroring `CHANNEL_COOLDOWN_MS` in
 * `chat.flood.service.ts`. The server is the authority; this copy exists so the
 * client can refuse the send locally and show the countdown without a round trip.
 */
export const CHANNEL_COOLDOWN_MS: Partial<Record<ChatChannel, number>> = {
  [ChatChannel.TRADE]: 120_000,
  [ChatChannel.RECRUITMENT]: 60_000,
  [ChatChannel.ALIGNMENT]: 60_000,
};

export function cooldownMsFor(channel: ChatChannel): number {
  return CHANNEL_COOLDOWN_MS[channel] ?? 0;
}

/** Retail caps a chat line at 200 characters (dofus/Constants.as:147). */
export const MAX_MESSAGE_LENGTH = 200;
