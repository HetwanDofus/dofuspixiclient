// GAF — Actions Finish (GameActions.as:111, DataProcessor.as:398)
// Wire: <actionId>|<spriteId>

import { F, WireIn } from "../../wire";

@WireIn({ opcode: "GAF", bodyOffset: 3 })
export class GAF {
  @F.int(0) actionId: number;
  @F.str(1) spriteId: string;
}
