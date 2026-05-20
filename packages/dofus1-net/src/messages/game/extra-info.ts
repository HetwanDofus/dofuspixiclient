// GI — request extra map info (outbound only).
// Wire: `GI` (no payload). Canonical aks/Game.as:47-67
// (`getExtraInformations`). Sent once the client has painted the
// terrain — server responds with `GM` (sprite roster) + `GDK`
// (map-ready) so the world becomes interactive.
//
// The canonical AS2 client toggles a one-time `Gi` (lowercase) variant
// that bundles "virtual machine state" info; we ship the plain `GI`
// path because the server-side handler ignores the flag.

import { WireOut } from "../../wire";

@WireOut({
  opcode: "GI",
  serialize() {
    return "";
  },
})
export class GIOut {}
