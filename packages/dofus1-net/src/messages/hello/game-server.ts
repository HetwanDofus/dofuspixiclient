// HG — Hello Game Server (Aks.as:701)

import { F, WireIn } from "../../wire";

@WireIn({ opcode: "HG", bodyOffset: 2 })
export class HG {
  @F.str(0) info: string;
}
