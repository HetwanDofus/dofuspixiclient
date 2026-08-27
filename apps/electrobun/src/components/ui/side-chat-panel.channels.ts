const SIDE_CHAT_CHANNEL = {
  INFOS: 0,
  ERRORS: 1,
  MESSAGES: 2,
  WISP: 3,
  GUILD: 4,
  PVP: 5,
  RECRUITMENT: 6,
  TRADE: 7,
  MEETIC: 8,
  ADMIN: 9,
  GAME_EVENTS: 10,
} as const;

type SideChatChannel =
  (typeof SIDE_CHAT_CHANNEL)[keyof typeof SIDE_CHAT_CHANNEL];

/**
 * Filter bucket → the colour of its checkbox — mirrors dofus/Constants.as:158-172.
 * Values are CSS variable references so the palette stays themable from
 * globals.css.
 *
 * These colour the *checkboxes*, not the messages. Bucket 3 hides three channels
 * at once ("Affiche / Cache les messages privés, de groupe et d'équipe") and its
 * box takes the whisper blue; per-message colours live in
 * `@/game/chat/chat-channels`.
 */
const SIDE_CHAT_CHANNEL_COLORS: Record<SideChatChannel, string> = {
  [SIDE_CHAT_CHANNEL.INFOS]: "var(--color-side-chat-channel-infos)",
  [SIDE_CHAT_CHANNEL.ERRORS]: "var(--color-side-chat-channel-errors)",
  [SIDE_CHAT_CHANNEL.MESSAGES]: "var(--color-side-chat-channel-messages)",
  [SIDE_CHAT_CHANNEL.WISP]: "var(--color-side-chat-channel-whisper)",
  [SIDE_CHAT_CHANNEL.GUILD]: "var(--color-side-chat-channel-guild)",
  [SIDE_CHAT_CHANNEL.PVP]: "var(--color-side-chat-channel-pvp)",
  [SIDE_CHAT_CHANNEL.RECRUITMENT]: "var(--color-side-chat-channel-recruitment)",
  [SIDE_CHAT_CHANNEL.TRADE]: "var(--color-side-chat-channel-trade)",
  [SIDE_CHAT_CHANNEL.MEETIC]: "var(--color-side-chat-channel-meetic)",
  [SIDE_CHAT_CHANNEL.ADMIN]: "var(--color-side-chat-channel-admin)",
  [SIDE_CHAT_CHANNEL.GAME_EVENTS]: "var(--color-side-chat-channel-game-events)",
};

/**
 * Channels exposed as filter checkboxes in the Retro D1Chat.html
 * (lines 216-247): IDs 0, 2, 3, 4, 5, 6, 7, 10. Errors (1), Meetic (8),
 * Admin (9) are intentionally excluded — errors are always shown, the
 * other two are owner-side only.
 */
const SIDE_CHAT_FILTER_CHANNELS: readonly SideChatChannel[] = [
  SIDE_CHAT_CHANNEL.INFOS,
  SIDE_CHAT_CHANNEL.MESSAGES,
  SIDE_CHAT_CHANNEL.WISP,
  SIDE_CHAT_CHANNEL.GUILD,
  SIDE_CHAT_CHANNEL.PVP,
  SIDE_CHAT_CHANNEL.RECRUITMENT,
  SIDE_CHAT_CHANNEL.TRADE,
  SIDE_CHAT_CHANNEL.GAME_EVENTS,
];

export type { SideChatChannel };
export {
  SIDE_CHAT_CHANNEL,
  SIDE_CHAT_CHANNEL_COLORS,
  SIDE_CHAT_FILTER_CHANNELS,
};
