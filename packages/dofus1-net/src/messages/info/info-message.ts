// Im — Info Message (Infos.as#onMessage, DataProcessor.as:493)
// Wire (bodyOffset=2): <kind>|<id>|<params;...>

import { F, WireIn } from "../../wire";

@WireIn({ opcode: "Im", bodyOffset: 2 })
export class Im {
  @F.str(0) kind: string;
  @F.int(1) id: number;
  @F.list(2, { sep: ";" }) params: string[];
}
