// GTS — Turn Start (Game.as:325, DataProcessor.as:408)
// Wire: spriteId|durationMs|tableTurn|<passive?="1">

import { F, WireIn } from "../../wire";

@WireIn({ opcode: "GTS", bodyOffset: 3 })
export class GTS {
  @F.str(0) spriteId: string;
  @F.int(1) durationMs: number;
  @F.int(2) tableTurn: number;
  @F.bool(3) passive: boolean;
}
