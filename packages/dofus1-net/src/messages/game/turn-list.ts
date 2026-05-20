// GTL — Turn List (Game.as:421, DataProcessor.as:414).
// Wire (bodyOffset=4): spriteId|spriteId|...

import { WireIn } from "../../wire";

@WireIn({
  opcode: "GTL",
  bodyOffset: 4,
  parse(body) {
    const inst = new GTL();
    inst.spriteIds = body === "" ? [] : body.split("|");
    return inst;
  },
})
export class GTL {
  spriteIds: string[];
}
