"use client";

import { ChatChannel } from "@dofus/proto/common_pb";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type { MainBannerChatFilter } from "@/components/ui/main-banner";
import type { ChatEntry } from "@/game/stores/chat-store";
import {
  MainBannerChat,
  MainBannerChatChannelButton,
  MainBannerChatInput,
} from "@/components/ui/main-banner";
import {
  SIDE_CHAT_CHANNEL_COLORS,
  SIDE_CHAT_FILTER_CHANNELS,
  type SideChatChannel,
} from "@/components/ui/side-chat-panel.channels";
import {
  MAX_MESSAGE_LENGTH,
  SELECTABLE_CHAT_CHANNELS,
  styleFor,
} from "@/game/chat/chat-channels";
import { parseChatInput } from "@/game/chat/chat-commands";
import {
  appendErrorMessage,
  armCooldown,
  chatStore,
  entryColor,
  remainingCooldown,
  setActiveChannel,
  setChannelVisible,
} from "@/game/stores/chat-store";
import { useGameClient } from "@/hud/contexts/GameClientContext";

/**
 * Retail filter tooltips, `CHAT_TYPE<n>` in public/assets/langs/fr/lang.json —
 * first line only; the full text is a paragraph about moderation rules.
 */
const FILTER_LABELS: Record<number, { label: string; title: string }> = {
  0: {
    label: "Informations",
    title: "Affiche / Cache les messages d'information.",
  },
  2: { label: "Général", title: "Affiche / Cache les messages communs." },
  3: {
    label: "Privé",
    title: "Affiche / Cache les messages privés, de groupe et d'équipe.",
  },
  4: { label: "Guilde", title: "Affiche / Cache les messages de guilde." },
  5: {
    label: "Alignement",
    title:
      "Affiche / Cache les messages de conquête de territoire et d'alignement.",
  },
  6: {
    label: "Recrutement",
    title: "Affiche / Cache les messages de recrutement.",
  },
  7: { label: "Commerce", title: "Affiche / Cache les messages de commerce." },
  10: { label: "Évènement", title: "Affiche / Cache les messages évènement." },
};

/** `Ce canal est restreint…` — INFOS_115 in the retail FR bundle. */
function floodNotice(seconds: number): string {
  return `Ce canal est restreint pour améliorer sa lisibilité. Vous pourrez envoyer un nouveau message dans ${seconds} secondes.`;
}

/**
 * Binds the banner chat primitives to `chatStore` and the network. This is the
 * game's only chat — the side panel that used to shadow it (QA-021) is gone.
 */
export function BannerChatContainer() {
  const gameClient = useGameClient();
  const { messages, visibleChannels, activeChannel, isOpen } =
    useSyncExternalStore(chatStore.subscribe, chatStore.getSnapshot);
  const [draft, setDraft] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  const cooldownTick = useCooldownTick();

  const handleSubmit = useCallback(
    (raw: string) => {
      const parsed = parseChatInput(raw, activeChannel);

      if (parsed.kind === "noop") {
        setDraft("");

        return;
      }

      if (parsed.kind === "error") {
        appendErrorMessage(parsed.text);
        setDraft("");

        return;
      }

      // The server is the authority on the interval; this guard just spares the
      // round trip and answers instantly. The draft is kept so the player can
      // resend once the countdown runs out.
      const remaining = remainingCooldown(parsed.channel);

      if (remaining > 0) {
        appendErrorMessage(floodNotice(remaining));

        return;
      }

      gameClient?.sendChat(parsed.destination, parsed.message);
      armCooldown(parsed.channel);

      // A whisper never comes back on the wire as something to echo locally —
      // the server sends the author their own WHISPER_TO frame — so nothing is
      // appended here for any channel.
      setDraft("");
    },
    [activeChannel, gameClient]
  );

  const filters: MainBannerChatFilter[] = SIDE_CHAT_FILTER_CHANNELS.map(
    (bucket) => ({
      id: bucket,
      color: SIDE_CHAT_CHANNEL_COLORS[bucket],
      label: FILTER_LABELS[bucket]?.label ?? `Canal ${bucket}`,
      title: FILTER_LABELS[bucket]?.title ?? "",
      checked: visibleChannels.has(bucket),
    })
  );

  const channelOptions = SELECTABLE_CHAT_CHANNELS.map((channel) => {
    const style = styleFor(channel);

    return {
      id: channel,
      label: style.label,
      color: style.color,
      shortcut: `/${SHORTCUTS[channel] ?? ""}`,
      cooldownSeconds: remainingCooldown(channel, cooldownTick),
    };
  });

  const visible = messages.filter(
    (entry) => entry.filter === undefined || visibleChannels.has(entry.filter)
  );

  // A new line pins the log to the bottom, as retail does.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the line count is the trigger, not a value read inside the effect.
  useLayoutEffect(() => {
    const log = logRef.current;

    if (log) {
      log.scrollTop = log.scrollHeight;
    }
  }, [visible.length]);

  if (!isOpen) {
    return null;
  }

  return (
    <>
      <MainBannerChat
        filters={filters}
        onToggleFilter={(id, checked) =>
          setChannelVisible(id as SideChatChannel, checked)
        }
        logRef={logRef}
      >
        {visible.map((entry) => (
          <ChatLine key={entry.id} entry={entry} />
        ))}
      </MainBannerChat>

      <MainBannerChatChannelButton
        options={channelOptions}
        activeId={activeChannel}
        onSelect={(id) => setActiveChannel(id as ChatChannel)}
      />

      <MainBannerChatInput
        placeholder="Discuter ici…"
        value={draft}
        maxLength={MAX_MESSAGE_LENGTH}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            handleSubmit(draft);
          }
        }}
      />
    </>
  );
}

/** Slash command shown next to each channel in the star menu. */
const SHORTCUTS: Partial<Record<ChatChannel, string>> = {
  [ChatChannel.GENERAL]: "s",
  [ChatChannel.TEAM]: "t",
  [ChatChannel.PARTY]: "p",
  [ChatChannel.GUILD]: "g",
  [ChatChannel.ALIGNMENT]: "a",
  [ChatChannel.RECRUITMENT]: "r",
  [ChatChannel.TRADE]: "b",
};

/**
 * Re-renders once a second, but only while something is actually counting down,
 * so an idle chat costs nothing.
 */
function useCooldownTick(): number {
  const [now, setNow] = useState(() => Date.now());
  const { cooldowns } = useSyncExternalStore(
    chatStore.subscribe,
    chatStore.getSnapshot
  );

  const anyPending = Object.values(cooldowns).some((until) => until > now);

  useEffect(() => {
    if (!anyPending) {
      return;
    }

    const id = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(id);
  }, [anyPending]);

  return now;
}

function ChatLine({ entry }: { entry: ChatEntry }) {
  const prefix = [
    entry.time ? `[${entry.time}]` : "",
    entry.channel !== undefined && entry.channel !== ChatChannel.GENERAL
      ? `(${styleFor(entry.channel).label})`
      : "",
    entry.player ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <p style={{ color: entryColor(entry), margin: 0 }}>
      {prefix ? `${prefix} : ` : ""}
      {entry.text}
    </p>
  );
}
