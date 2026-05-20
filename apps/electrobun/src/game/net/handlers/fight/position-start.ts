// GP — Placement cells per team. Server pushes this once at the start
// of placement; the battlefield UI then paints the team1/team2 cells.
// The cell payloads are base64-paired strings — decoded by the grid
// layer when the UI consumes them.

import { GP } from "@dofus/dofus1-net";

import type { NetClient } from "@/game/net/client";
import { createLogger } from "@/utils/logger";

const log = createLogger("handler.GP");

export interface PositionStartListener {
  (info: {
    team1Cells: string;
    team2Cells: string;
    playerTeam: number;
  }): void;
}

const listeners = new Set<PositionStartListener>();

export function onPositionStart(cb: PositionStartListener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function registerPositionStart(client: NetClient): void {
  client.on(GP, (msg) => {
    log.debug(
      `placement t1=${msg.team1Cells.length}c t2=${msg.team2Cells.length}c team=${msg.playerTeam}`,
    );
    for (const cb of listeners) {
      cb({
        team1Cells: msg.team1Cells,
        team2Cells: msg.team2Cells,
        playerTeam: msg.playerTeam,
      });
    }
  });
}
