// Gp — set player placement cell (outbound only).
// Wire: `Gp<cellNum>` — canonical aks/Game.as:32-35
// (`setPlayerPosition`). The lowercase `p` distinguishes this
// outbound frame from the inbound `GP` (uppercase) which carries
// the team-cell placement set at fight start.

import { WireOut } from "../../wire";

@WireOut({
  opcode: "Gp",
  serialize(m) {
    const out = m as GpOut;
    return String(out.cellId);
  },
})
export class GpOut {
  cellId: number;
}
