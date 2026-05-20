// GTF — Turn Finish (Game.as:405, DataProcessor.as:411)

import { F, WireIn } from "../../wire";

@WireIn({ opcode: "GTF", bodyOffset: 3 })
export class GTF {
  @F.str(0) spriteId: string;
}
