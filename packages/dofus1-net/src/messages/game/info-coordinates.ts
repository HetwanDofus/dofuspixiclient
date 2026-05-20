// GIC — Game Info Coordinates (Game.as:241 `onPlayersCoordinates`,
// DataProcessor.as:332).
//
// Server-authoritative confirmation of new sprite cell positions —
// fired during fight placement after the client sends `Gp<cell>`, and
// anywhere the server moves sprites without a movement animation (most
// notably teleport-style placement swaps). Each row is one sprite that
// moved.
//
// Wire: `GIC|<spriteId>;<cell>|<spriteId>;<cell>|...`
// After bodyOffset=3 strips "GIC", the body begins with a leading "|"
// (the canonical AS2 substr(4) skips it too), so we filter empty rows.

import { WireIn } from "../../wire";

export interface GICCoordRow {
  spriteId: string;
  cell: number;
}

@WireIn({
  opcode: "GIC",
  bodyOffset: 3,
  parse(body) {
    const inst = new GIC();
    if (body.length === 0) {
      return inst;
    }
    for (const raw of body.split("|")) {
      if (raw.length === 0) {
        continue;
      }
      const sep = raw.indexOf(";");
      if (sep < 0) {
        continue;
      }
      const spriteId = raw.slice(0, sep);
      const cell = Number.parseInt(raw.slice(sep + 1), 10);
      if (!spriteId || !Number.isFinite(cell)) {
        continue;
      }
      inst.coords.push({ spriteId, cell });
    }
    return inst;
  },
})
export class GIC {
  coords: GICCoordRow[] = [];
}
