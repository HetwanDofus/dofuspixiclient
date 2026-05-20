// WU — Zaap teleport rejected. Surface as a toast / info message; no
// other state to mutate.

import { WU } from "@dofus/dofus1-net";

import type { NetClient } from "@/game/net/client";
import { appendInfoMessage } from "@/game/stores/chat-store";

export function registerWaypointUseError(client: NetClient): void {
  client.on(WU, () => {
    appendInfoMessage("Teleport rejected by the server.");
  });
}
