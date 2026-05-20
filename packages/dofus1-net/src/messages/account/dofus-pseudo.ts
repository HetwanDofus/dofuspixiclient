// Ad — Dofus pseudo (Account.as:263, DataProcessor.as:193)

import { F, WireIn } from "../../wire";

@WireIn({ opcode: "Ad", bodyOffset: 2 })
export class Ad {
  @F.str(0) pseudo: string;
}
