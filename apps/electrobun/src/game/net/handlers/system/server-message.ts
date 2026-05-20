// M — Server message (pre-login banner or interactive popup).
//
// `preLogin` flavour is queued for the login screen; `interactive`
// flavour wants a modal with an optional callback to fire when the
// user dismisses / acknowledges it.
//
// Until the modal manager exists, route both into the chat info pane
// so the step-5 tester sees the content.

import { ServerMessage } from "@dofus/dofus1-net";

import type { NetClient } from "@/game/net/client";
import { appendInfoMessage } from "@/game/stores/chat-store";

export function registerServerMessage(client: NetClient): void {
  client.on(ServerMessage, (msg) => {
    const params = msg.params.length > 0 ? ` ${msg.params.join(" / ")}` : "";
    appendInfoMessage(`[${msg.kind}/${msg.id}]${params}`);
  });
}
