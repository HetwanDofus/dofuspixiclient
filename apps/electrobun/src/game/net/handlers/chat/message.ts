// cM — Chat message. Canonical Dofus 1.29 wire (Chat.as#onMessage):
//
//   cM<channel:1><senderId>|<senderName>|<channelMeta…>|<message>
//
// The channel char maps to one of the side-chat channels (general /
// guild / party / whisper / commerce / recruitment / alliance). The
// post-channel payload is pipe-separated and the message itself is
// always the LAST segment after the metadata block.
//
// Until the channel char → SideChatChannel mapping is wired, append
// everything to the catch-all "general" channel so messages are
// visible in step-5 testing.

import { CM } from "@dofus/dofus1-net";

import { SIDE_CHAT_CHANNEL } from "@/components/ui/side-chat-panel.channels";
import type { NetClient } from "@/game/net/client";
import { appendChatMessage } from "@/game/stores/chat-store";

export function registerChatMessage(client: NetClient): void {
  client.on(CM, (msg) => {
    const parts = msg.raw.split("|");
    // Canonical layout: <senderId>|<senderName>|...|<message>.
    // Sender name lives at index 1; message text is the trailing
    // segment.
    const player = parts[1] ?? "";
    const text = parts[parts.length - 1] ?? "";
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");

    appendChatMessage({
      channel: SIDE_CHAT_CHANNEL.MESSAGES,
      time: `${hh}:${mm}`,
      player: player || undefined,
      text,
    });
  });
}
