// GAS — Actions Start (GameActions.as:95, DataProcessor.as:395)

import { F, WireIn } from "../../wire";

@WireIn({ opcode: "GAS", bodyOffset: 3 })
export class GAS {
  @F.str(0) spriteId: string;
}
