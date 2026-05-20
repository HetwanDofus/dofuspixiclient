// AK — Network key install (Account.as:255, DataProcessor.as:256).
// Wire: <keyId-hex-char><keyHex>

import { WireIn } from "../../wire";

@WireIn({
  opcode: "AK",
  bodyOffset: 2,
  parse(body) {
    const inst = new AK();
    const n = Number.parseInt(body.charAt(0), 16);
    inst.keyId = Number.isNaN(n) ? 0 : n;
    inst.keyHex = body.slice(1);
    return inst;
  },
})
export class AK {
  keyId: number;
  keyHex: string;
}
