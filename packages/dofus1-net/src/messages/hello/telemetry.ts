// HT — Hello Telemetry (Aks.as:714)

import { F, WireIn } from "../../wire";

@WireIn({ opcode: "HT", bodyOffset: 2 })
export class HT {
  @F.str(0) raw: string;
}
