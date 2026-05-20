// Inbound admin command responses — wired against typed `BA*`
// classes from dofus1-net. The subops mirror DataProcessor.as:91-120:
//
//   BAT<extra> → onAuthorizedCommand(true, extra) — text response
//   BAE       → onAuthorizedCommand(false)        — failure flag
//   BAC       → onAuthorizedCommandClear         — wipe log buffer
//   BAP<txt>  → onAuthorizedCommandPrompt        — change prompt
//   BAL<row>  → onAuthorizedLine                 — replace one line
//   BAl<list> → onAuthorizedCommandsListing      — autocomplete list

import { BAC, BAE, BAL, BAl, BAP, BAT } from "@dofus/dofus1-net";

import type { NetClient } from "@/game/net/client";
import {
  appendConsoleLog,
  type ConsoleLogLevel,
  clearConsoleLogs,
  consoleStore,
} from "@/game/stores";

const allowedAdminCommands: string[] = [];

/**
 * Read-only view of the autocomplete list pushed by `BAl`. Not yet
 * consumed by a UI — the Tab handler in ConsoleContainer is a no-op
 * until autocomplete is wired.
 */
export function getAllowedAdminCommands(): readonly string[] {
  return allowedAdminCommands;
}

export function registerAuthorizedCommand(client: NetClient): void {
  client.on(BAT, (msg) => onAuthorizedCommand(msg.body));
  client.on(BAE, () => {
    // Basics.as:415-418 — bSuccess === false branch surfaces a
    // localised "UNKNOW_COMMAND" toast on ERROR_CHAT. Inside the
    // console we just append the same message in red.
    appendConsoleLog("Unknown command (server rejected /a)", "error");
  });
  client.on(BAC, () => clearConsoleLogs());
  client.on(BAP, (msg) => {
    // Basics.as:420 — empty payload is a no-op per canonical.
    if (msg.prompt.length > 0) {
      consoleStore.setState({ prompt: msg.prompt });
    }
  });
  client.on(BAL, (msg) => onAuthorizedLine(msg.body));
  client.on(BAl, (msg) => {
    // Basics.as:434 — overwrite the list in-place so external readers
    // see the latest set without changing the array identity.
    allowedAdminCommands.splice(
      0,
      allowedAdminCommands.length,
      ...msg.commands
    );
  });
}

/**
 * Decode a `BAT` text response. Canonical layout (Basics.as:263-298):
 *   <type:int>|<reportLinkMode:int>|<gridPrefix>|<message…>
 *
 * `type` selects the colour channel:
 *   0 → DEBUG_LOG (white) | 1 → DEBUG_ERROR (red) | 2 → DEBUG_INFO (green)
 *
 * `type === 4` is the electron-bridged special path (Basics.as:265-273)
 * — the actual type lives at offset +1 with an extra leading segment.
 * We mirror the same fix-up so server frames that come through that
 * path still surface correctly.
 *
 * Multi-pipe messages re-join the trailing segments so embedded `|` in
 * the payload doesn't get truncated.
 */
function onAuthorizedCommand(extraData: string): void {
  const parts = extraData.split("|");
  let typeIdx = Number(parts[0]);
  if (typeIdx === 4) {
    // Basics.as:265-273 — electron channel rewrites: skip 2 prefix
    // segments and parse the type out of the 3-char suffix.
    parts.splice(0, 2);
    typeIdx = Number((parts[0] ?? "").substring(3));
  }
  // reportLinkMode + grid prefix are owner tooling; drop both.
  parts.splice(0, 3);
  const message = parts.join("|");
  if (message.length === 0) {
    return;
  }
  appendConsoleLog(stripHtml(message), levelForType(typeIdx));
}

/**
 * `BAL` replaces a previously-logged line (counted from the bottom).
 * The new client doesn't track line offsets that way — we just append
 * the replacement as a new entry, which is visually close enough for
 * the streaming-batch use case it supports (Basics.as:438-460).
 */
function onAuthorizedLine(extraData: string): void {
  const parts = extraData.split("|");
  const type = Number(parts[1]);
  const text = parts[2] ?? "";
  if (text.length === 0) {
    return;
  }
  appendConsoleLog(stripHtml(text), levelForType(type));
}

function levelForType(typeIdx: number): ConsoleLogLevel {
  switch (typeIdx) {
    case 1:
      return "error";
    case 2:
      return "info";
    default:
      return "default";
  }
}

// Server messages embed `<font color>`, `<b>`, `<br/>`, etc. — the
// canonical Flash widget renders HTML, but our console paints plain
// strings via per-line `data-level` colouring. Strip the markup
// rather than leaking tag noise into the visible text.
function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"');
}
