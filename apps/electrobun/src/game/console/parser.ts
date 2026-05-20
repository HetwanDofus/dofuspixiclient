// Slash-command parser for the admin console. Mirrors the subset of
// `dofus.utils.consoleParsers.DebugConsoleParser.processOneAdminCommand`
// that's relevant client-side. Anything not matched here is forwarded to
// the server as a raw `BA<cmd>` admin command frame — canonical
// `dofus.aks.Basics.autorisedCommand(sCommand)` (Basics.as:17):
//   this.aks.send("BA" + sCommand, false, undefined, true);
//
// The server-side reply lands as an `Im` info-message or a chat `cM`,
// which already routes through the existing inbound handlers. Errors
// for unknown commands are rendered as red lines in the console.

import { BAOut } from "@dofus/dofus1-net";

import type { NetClient } from "@/game/net/client";
import {
  appendConsoleLog,
  clearConsoleLogs,
  closeConsole,
  consoleStore,
  pushConsoleHistory,
  setConsoleSize,
} from "@/game/stores";

export interface ConsoleParserContext {
  client: NetClient | null;
}

const MULTIPLE_ADMIN_COMMANDS_SPLIT_STR = " ; ";

export function processConsoleCommand(
  raw: string,
  ctx: ConsoleParserContext
): void {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return;
  }
  pushConsoleHistory(trimmed);

  // Echo the command so the user can see what they sent — the canonical
  // AS2 console relies on the server's `BAT` response to confirm, but
  // without a visible echo intermediate latency makes the box feel
  // dead. Format mirrors the `prompt > cmd` shape the input row shows.
  const { prompt } = consoleStore.getSnapshot();
  appendConsoleLog(`${prompt} > ${trimmed}`, "default");

  // Canonical AS2 splits on " ; " (Basics.as:6, DebugConsoleParser.as:15)
  // so chained commands like `/spawn x ; /move y` dispatch sequentially.
  const parts = trimmed.split(MULTIPLE_ADMIN_COMMANDS_SPLIT_STR);
  for (const part of parts) {
    processOneCommand(part, ctx);
  }
}

function processOneCommand(sCmd: string, ctx: ConsoleParserContext): void {
  if (sCmd.charAt(0) !== "/") {
    // Non-slash text in the console is treated as a raw admin command —
    // mirrors `DebugConsoleParser.processOneAdminCommand` else-branch
    // (DebugConsoleParser.as:974) which calls `Basics.autorisedCommand`.
    sendAdmin(sCmd, ctx);
    return;
  }

  const tokens = sCmd.split(" ");
  const cmd = (tokens[0]?.substring(1) ?? "").toUpperCase();

  switch (cmd) {
    case "CLEAR":
      // DebugConsoleParser.as:714 — `/clear` wipes the local log buffer
      // (api.ui.getUIComponent("Debug").clear()).
      clearConsoleLogs();
      return;

    case "CONSOLECLOSE":
      // DebugConsoleParser.as:819 — `/consoleclose` shuts the widget.
      closeConsole();
      return;

    case "CONSOLEMEDIUM":
      // DebugConsoleParser.as:164.
      setConsoleSize("medium");
      return;

    case "CONSOLEMINIMIZED":
      // DebugConsoleParser.as:153.
      setConsoleSize("minimized");
      return;

    case "CONSOLEMAXSIZE":
      // DebugConsoleParser.as:142.
      setConsoleSize("max");
      return;

    default:
      // Unmatched slash command — forward verbatim (minus the leading "/")
      // to the server. The canonical client did this same fall-through
      // via `api.network.Basics.autorisedCommand(sCmd)` after analysing
      // the local command list (DebugConsoleParser.as:974-982).
      sendAdmin(sCmd, ctx);
      return;
  }
}

function sendAdmin(sCmd: string, ctx: ConsoleParserContext): void {
  const client = ctx.client;
  if (!client || !client.isConnected()) {
    appendConsoleLog("Not connected — admin command dropped.", "error");
    return;
  }
  // Canonical wire: `BA<command-text>` (Basics.as:17 —
  // `autorisedCommand`). Serialized by `BAOut` so the call goes
  // through the typed dofus1-net protocol.
  client.send(BAOut, { command: sCmd });
}
