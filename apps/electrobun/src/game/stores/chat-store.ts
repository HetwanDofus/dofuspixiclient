import {
  SIDE_CHAT_CHANNEL,
  SIDE_CHAT_FILTER_CHANNELS,
  type SideChatChannel,
} from "@/components/ui/side-chat-panel.channels";

import { ExternalStore } from "./game-store";

type Side = "left" | "right";

/**
 * Single chat entry. `channel` and `player` are absent for info-log
 * entries (e.g. system account/IP notices rendered in the green pane).
 */
export interface ChatEntry {
  id: string;
  channel?: SideChatChannel;
  /** Zero-padded `HH:MM` server-side timestamp. Undefined for info entries. */
  time?: string;
  player?: string;
  text: string;
}

export interface ChatState {
  /** Infos pane entries (always shown at the top regardless of filters). */
  infos: ChatEntry[];
  /** Main chat log entries. Filtered by `visibleChannels` at render time. */
  messages: ChatEntry[];
  /** Channels the user has toggled on in the filter row. */
  visibleChannels: Set<SideChatChannel>;
  /** Which side of the screen the panel docks to. */
  side: Side;
  /** Currently selected message prefix (e.g. "/s", "/g"). */
  prefix: string;
  /** Is the side chat panel currently visible? */
  isOpen: boolean;
}

const DEFAULT_VISIBLE_CHANNELS = new Set<SideChatChannel>(
  SIDE_CHAT_FILTER_CHANNELS
);

const initialState: ChatState = {
  infos: [],
  messages: [],
  visibleChannels: DEFAULT_VISIBLE_CHANNELS,
  side: "right",
  prefix: "/s",
  isOpen: true,
};

export const chatStore = new ExternalStore<ChatState>(initialState);

let nextId = 1;
function makeId(): string {
  return `c${nextId++}`;
}

export function appendChatMessage(entry: Omit<ChatEntry, "id">): void {
  const { messages } = chatStore.getSnapshot();
  chatStore.setState({
    messages: [...messages, { id: makeId(), ...entry }],
  });
}

export function appendInfoMessage(text: string): void {
  const { infos } = chatStore.getSnapshot();
  chatStore.setState({
    infos: [...infos, { id: makeId(), channel: SIDE_CHAT_CHANNEL.INFOS, text }],
  });
}

export function clearChat(): void {
  chatStore.setState({ messages: [], infos: [] });
}

export function setChannelVisible(
  channel: SideChatChannel,
  visible: boolean
): void {
  const { visibleChannels } = chatStore.getSnapshot();
  const next = new Set(visibleChannels);
  if (visible) {
    next.add(channel);
  } else {
    next.delete(channel);
  }
  chatStore.setState({ visibleChannels: next });
}

export function setChatSide(side: Side): void {
  chatStore.setState({ side });
}

export function setChatPrefix(prefix: string): void {
  chatStore.setState({ prefix });
}

export function toggleChatOpen(): void {
  const { isOpen } = chatStore.getSnapshot();
  chatStore.setState({ isOpen: !isOpen });
}
