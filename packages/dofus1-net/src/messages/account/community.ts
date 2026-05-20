// Ac — Community id (Account.as:267, DataProcessor.as:190)

import { F, WireIn } from "../../wire";

@WireIn({ opcode: "Ac", bodyOffset: 2 })
export class Ac {
  @F.int(0) communityId: number;
}
