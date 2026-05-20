// GE — Game / fight end (extend.GameIn#onEnd, DataProcessor.as:311).
// Raw + pipe-split sections; structured fight-result decoder pending.

import { WireIn } from "../../wire";

@WireIn({
  opcode: "GE",
  bodyOffset: 2,
  parse(body) {
    const inst = new GE();
    inst.raw = body;
    inst.sections = body === "" ? [] : body.split("|");
    
    return inst;
  },
})
export class GE {
  raw: string;
  sections: string[];
}
