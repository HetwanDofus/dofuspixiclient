// GC — Game Create (Game.as:103, DataProcessor.as:296)
// Wire (bodyOffset=4): <gameType>|<more-fields-AS2-ignores>

import { F, WireIn } from "../../wire";

@WireIn({ opcode: "GC", bodyOffset: 4 })
export class GC {
  @F.int(0, { default: 1 }) gameType: number;
}
