// OA — Item Add (Items.as#onAdd, DataProcessor.as:563)
// Raw item blob — Items.parseItemData decoder still pending.

import { F, WireIn } from "../../wire";

@WireIn({ opcode: "OA", bodyOffset: 3 })
export class OA {
  @F.str(0) raw: string;
}
