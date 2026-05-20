// As — Account Stats (Account.as#onStats, DataProcessor.as:223).
// Raw body + pipe-split sections; per-section decoder pending.

import { WireIn } from "../../wire";

@WireIn({
  opcode: "As",
  bodyOffset: 2,
  parse(body) {
    const inst = new As();
    inst.raw = body;
    inst.sections = body === "" ? [] : body.split("|");
    return inst;
  },
})
export class As {
  raw: string;
  sections: string[];
}
