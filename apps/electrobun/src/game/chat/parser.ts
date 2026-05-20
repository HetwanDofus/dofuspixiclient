// Slash-command parser for the side chat input. Mirrors the subset of
// `dofus.utils.consoleParsers.ChatConsoleParser.process` that's relevant
// without the broader datacenter — currently:
//
//   • `/console` — opens the admin console (Debug widget). Restricted to
//     authorized players; otherwise echoes `Unknown command` in red.
//   • All other slash commands are echoed as `Unknown command` so the user
//     sees feedback instead of the command being silently sent to chat.
//
// Plain (non-slash) text falls through to the caller's `sendChat`
// callback which serializes a `cM*|<msg>` frame to the server.

import { SIDE_CHAT_CHANNEL } from "@/components/ui/side-chat-panel.channels";
import { appendChatMessage, openConsole, playerStore } from "@/game/stores";

export interface ChatParserResult {
  /** True when the parser consumed the input — caller should NOT send to chat. */
  handled: boolean;
}

interface ChatParserContext {
  /**
   * Plain-text chat sender (no leading slash). Called when the parser
   * decides the input is a regular chat line and should hit the wire.
   */
  sendChat: (text: string) => void;
}

export function parseChatInput(
  raw: string,
  ctx: ChatParserContext
): ChatParserResult {
  const text = raw.trim();
  if (text.length === 0) {
    return { handled: true };
  }

  if (text.charAt(0) !== "/") {
    ctx.sendChat(text);
    return { handled: true };
  }

  const tokens = text.split(" ").filter((t) => t.length > 0);
  // `tokens[0]` is the slash command itself; canonical AS2 strips the
  // leading "/" and uppercases for matching (ChatConsoleParser.as:65).
  const cmd = (tokens[0]?.substring(1) ?? "").toUpperCase();

  switch (cmd) {
    case "CONSOLE": {
      const { isAuthorized } = playerStore.getSnapshot();
      if (isAuthorized) {
        openConsole();
      } else {
        // Same shape Kernel.showMessage emits for UNKNOW_COMMAND on the
        // ERROR_CHAT channel (Kernel.as:399 / lang token `UNKNOW_COMMAND`).
        appendChatMessage({
          channel: SIDE_CHAT_CHANNEL.ERRORS,
          text: `Unknown command : ${cmd}`,
        });
      }
      return { handled: true };
    }
    default: {
      // Unknown / unimplemented slash command — surface the failure so
      // the user knows the message did NOT go to chat as text.
      appendChatMessage({
        channel: SIDE_CHAT_CHANNEL.ERRORS,
        text: `Unknown command : ${cmd}`,
      });
      return { handled: true };
    }
  }
}
