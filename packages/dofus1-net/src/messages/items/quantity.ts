// OQ — Item Quantity (Items.as#onQuantity, DataProcessor.as:572)
// Wire (bodyOffset=2): <itemId>|<newQuantity>

import { F, WireIn } from "../../wire";

@WireIn({ opcode: "OQ", bodyOffset: 2 })
export class OQ {
  @F.str(0) itemId: string;
  @F.int(1) quantity: number;
}
