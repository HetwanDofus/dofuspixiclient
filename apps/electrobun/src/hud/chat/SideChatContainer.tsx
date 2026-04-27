import { useCallback, useState, useSyncExternalStore } from "react";

import { SideChatSearchIcon } from "@/components/ui/icons/side-chat-panel/search";
import { SideChatTrashIcon } from "@/components/ui/icons/side-chat-panel/trash";
import {
  SideChatPanel,
  SideChatPanelActionButton,
  SideChatPanelFilter,
  SideChatPanelFilterGroup,
  SideChatPanelFilters,
  SideChatPanelInfoLog,
  SideChatPanelInputRow,
  SideChatPanelLog,
  SideChatPanelMessage,
  SideChatPanelMovePanelButton,
  SideChatPanelPrefixButton,
  SideChatPanelTextInput,
} from "@/components/ui/side-chat-panel";
import {
  SIDE_CHAT_CHANNEL,
  SIDE_CHAT_CHANNEL_COLORS,
  SIDE_CHAT_FILTER_CHANNELS,
  type SideChatChannel,
} from "@/components/ui/side-chat-panel.channels";
import {
  appendChatMessage,
  chatStore,
  clearChat,
  setChannelVisible,
  setChatSide,
} from "@/game/stores/chat-store";

/**
 * Labels rendered in parens next to each message (e.g. `(Guild)`). Keep
 * them in the container (display layer) rather than the registry —
 * downstream consumers may localize or rename these independently.
 */
const CHANNEL_LABELS: Record<SideChatChannel, string> = {
  [SIDE_CHAT_CHANNEL.INFOS]: "Info",
  [SIDE_CHAT_CHANNEL.ERRORS]: "Error",
  [SIDE_CHAT_CHANNEL.MESSAGES]: "General",
  [SIDE_CHAT_CHANNEL.WISP]: "Group",
  [SIDE_CHAT_CHANNEL.GUILD]: "Guild",
  [SIDE_CHAT_CHANNEL.PVP]: "PVP",
  [SIDE_CHAT_CHANNEL.RECRUITMENT]: "Recruitment",
  [SIDE_CHAT_CHANNEL.TRADE]: "Trade",
  [SIDE_CHAT_CHANNEL.MEETIC]: "Private",
  [SIDE_CHAT_CHANNEL.ADMIN]: "Admin",
  [SIDE_CHAT_CHANNEL.GAME_EVENTS]: "Event",
};

/**
 * Thin adapter that binds the shared `<SideChatPanel>` primitives from the
 * `@dofus1` registry to the live `chatStore`. Subscribes via
 * `useSyncExternalStore` so both the messages list and the filter row stay
 * reactive to store updates.
 */
export function SideChatContainer() {
  const { infos, messages, visibleChannels, side, prefix, isOpen } =
    useSyncExternalStore(chatStore.subscribe, chatStore.getSnapshot);
  const [draft, setDraft] = useState("");

  const handleSubmit = useCallback((value: string) => {
    const text = value.trim();
    if (!text) {
      return;
    }
    // Local echo until the server-side chat round-trip lands — keeps the
    // UI responsive and gives us a target to diff against when wiring the
    // real dispatch in `GameClient`.
    appendChatMessage({
      channel: SIDE_CHAT_CHANNEL.MESSAGES,
      player: "You",
      time: new Date().toTimeString().slice(0, 5),
      text,
    });
    setDraft("");
  }, []);

  const handleFilterChange = useCallback(
    (channel: SideChatChannel, checked: boolean) => {
      setChannelVisible(channel, checked);
    },
    []
  );

  if (!isOpen) {
    return null;
  }

  const filteredMessages = messages.filter(
    (m) => m.channel === undefined || visibleChannels.has(m.channel)
  );

  return (
    <SideChatPanel side={side} theme="light">
      <SideChatPanelFilters>
        <SideChatPanelFilterGroup>
          {SIDE_CHAT_FILTER_CHANNELS.map((ch) => (
            <SideChatPanelFilter
              key={ch}
              color={SIDE_CHAT_CHANNEL_COLORS[ch]}
              label={`Channel ${ch}`}
              checked={visibleChannels.has(ch)}
              onChange={(e) => handleFilterChange(ch, e.target.checked)}
            />
          ))}
        </SideChatPanelFilterGroup>
        <SideChatPanelActionButton aria-label="Search">
          <SideChatSearchIcon />
        </SideChatPanelActionButton>
        <SideChatPanelActionButton aria-label="Clear chat" onClick={clearChat}>
          <SideChatTrashIcon />
        </SideChatPanelActionButton>
        <SideChatPanelMovePanelButton onMove={setChatSide} />
      </SideChatPanelFilters>

      {infos.length > 0 ? (
        // When the INFOS channel is visible, the original retroclient
        // splits the panel 50/50 between infos and the main chat log.
        // `flex-1 basis-0` overrides the component's default `shrink-0`
        // so both panes participate equally in the flex distribution.
        <SideChatPanelInfoLog className="flex-1 basis-0 min-h-0">
          {infos.map((entry) => (
            <SideChatPanelMessage
              key={entry.id}
              color={
                entry.channel !== undefined
                  ? SIDE_CHAT_CHANNEL_COLORS[entry.channel]
                  : undefined
              }
            >
              {entry.text}
            </SideChatPanelMessage>
          ))}
        </SideChatPanelInfoLog>
      ) : null}

      <SideChatPanelLog>
        {filteredMessages.map((entry) => (
          <SideChatPanelMessage
            key={entry.id}
            color={
              entry.channel !== undefined
                ? SIDE_CHAT_CHANNEL_COLORS[entry.channel]
                : undefined
            }
            time={entry.time}
            channel={
              entry.channel !== undefined
                ? CHANNEL_LABELS[entry.channel]
                : undefined
            }
            player={entry.player}
          >
            {entry.text}
          </SideChatPanelMessage>
        ))}
      </SideChatPanelLog>

      <SideChatPanelInputRow>
        <SideChatPanelPrefixButton prefix={prefix} />
        <SideChatPanelTextInput
          placeholder="Say something..."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onSubmit={handleSubmit}
        />
      </SideChatPanelInputRow>
    </SideChatPanel>
  );
}
