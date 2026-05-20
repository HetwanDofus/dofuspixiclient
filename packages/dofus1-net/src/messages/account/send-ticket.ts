// AT — Send/receive game-server ticket (Account.as:141 out / 847 in,
// DataProcessor.as:208).

import { F, WireIn, WireOut } from "../../wire";

@WireIn({
  opcode: "AT",
  bodyOffset: 3,
  parse(body) {
    const inst = new AT();
    const n = Number.parseInt(body.charAt(0), 16);
    if (Number.isNaN(n)) {
      inst.keyId = -1;
      inst.keyHex = "";
    } else {
      inst.keyId = n;
      inst.keyHex = body.slice(1);
    }
    return inst;
  },
})
export class AT {
  /** -1 = no-op, 0 = useKey(0) only, >0 = install + useKey. */
  keyId: number;
  /** Empty when keyId ≤ 0. */
  keyHex: string;
}

@WireOut({ opcode: "AT" })
export class ATOut {
  @F.str(0) ticket: string;
}
