// GR — Ready toggle (Game.as:266, DataProcessor.as:305).
// Inbound wire: <"0"|"1"><spriteId> — flag char immediately followed by id.
// Outbound wire: <"0"|"1"> — placement-only client→server toggle
// (aks/Game.as:36-39 `ready(bReady)`).

import { WireIn, WireOut } from "../../wire";

@WireIn({
  opcode: "GR",
  bodyOffset: 2,
  parse(body) {
    const inst = new GR();
    inst.ready = body.charAt(0) === "1";
    inst.spriteId = body.slice(1);
    return inst;
  },
})
export class GR {
  ready: boolean;
  spriteId: string;
}

@WireOut({
  opcode: "GR",
  serialize(m) {
    const out = m as GROut;
    return out.ready ? "1" : "0";
  },
})
export class GROut {
  ready: boolean;
}
