// GF — voluntary surrender (outbound only).
// Wire: `GF` (no payload). Canonical aks/Game.as:91-94.
// Server resolves the fight with the surrendering team marked as
// loser; clients receive a follow-up GE (game-end).

import { WireOut } from "../../wire";

@WireOut({
  opcode: "GF",
  serialize() {
    return "";
  },
})
export class GFOut {}
