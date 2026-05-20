// Aq — Queue position (Account.as:1229, DataProcessor.as:244)

import { F, WireIn } from "../../wire";

@WireIn({ opcode: "Aq", bodyOffset: 2 })
export class Aq {
  @F.int(0) position: number;
}
