// Ak — Key acknowledge (Account.as:171, outbound only).
// `Ak<HEX[keyId]>` — confirms a network key is installed.

import { WireOut } from "../../wire";

const HEX = "0123456789ABCDEF";

@WireOut({
  opcode: "Ak",
  serialize(m) {
    return HEX[(m as AkOut).keyId & 0xf] as string;
  },
})
export class AkOut {
  keyId: number;
}
