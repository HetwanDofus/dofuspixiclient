// GKK — Game Action acknowledgement (outbound only).
// Wire: `GKK<actionId>`. Canonical aks/GameActions.as:28 —
// `actionAck(nActionID)` sends `GKK<id>` once the local visual for a
// server-originated action completes. Without it the server keeps
// the actor flagged "busy" and answers every subsequent action with
// `GA;0` (NOOP).

import { WireOut } from "../../wire";

@WireOut({
  opcode: "GKK",
  serialize(m) {
    const out = m as GKKOut;
    return String(out.actionId);
  },
})
export class GKKOut {
  actionId: number;
}
