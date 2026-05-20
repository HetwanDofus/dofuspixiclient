// AR — Player restrictions bitfield (Account.as:1160, DataProcessor.as:229)
// Wire (bodyOffset=2): base-36 encoded integer.

import { F, WireIn } from "../../wire";

@WireIn({ opcode: "AR", bodyOffset: 2 })
export class AR {
  @F.int36(0) restrictions: number;
}
