// Gt — voluntary turn end (outbound only).
// Wire: `Gt` (no payload). Canonical aks/Game.as:68-74 — only fires
// when `datacenter.Player.isCurrentPlayer` is true. Server replies
// with the next fighter's GTS.

import { WireOut } from "../../wire";

@WireOut({
  opcode: "Gt",
  serialize() {
    return "";
  },
})
export class GtOut {}
