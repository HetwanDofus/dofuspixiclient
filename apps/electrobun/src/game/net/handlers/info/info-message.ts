// Im — Info / system message. Server pushes templated info entries
// (welcome banners, level-up notifications, chat-channel errors).
// Routed into the chat panel's info pane.

import { Im } from "@dofus/dofus1-net";

import type { NetClient } from "@/game/net/client";
import { appendInfoMessage } from "@/game/stores/chat-store";

export function registerInfoMessage(client: NetClient): void {
  client.on(Im, (msg) => {
    // Template id + params — full localized expansion lives in the
    // datacenter Infos table (Infos.as#getMessage). Until the lookup
    // is ported we surface the raw template id so step-5 logs are
    // still useful.
    const summary =
      msg.params.length > 0
        ? `info ${msg.kind}/${msg.id}: ${msg.params.join(" / ")}`
        : `info ${msg.kind}/${msg.id}`;
    appendInfoMessage(summary);
  });
}
