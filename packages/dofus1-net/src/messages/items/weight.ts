// Ow — Item Weight (Items.as#onWeight, DataProcessor.as:581)
// Wire: <current>|<max>

import { F, WireIn } from "../../wire";

@WireIn({ opcode: "Ow", bodyOffset: 2 })
export class Ow {
  @F.int(0) current: number;
  @F.int(1) max: number;
}
