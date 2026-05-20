// GTR — Turn Ready ack (Game.as:525, DataProcessor.as:420)

import { F, WireIn } from "../../wire";

@WireIn({ opcode: "GTR", bodyOffset: 3 })
export class GTR {
  @F.str(0) spriteId: string;
}
