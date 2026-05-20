// GA — Game Action stream (GameActions.as:21+139, DataProcessor.as:402).
// Inbound: `GA<actionId>;<actionType>;<sourceSpriteId>;<args…>`
// Outbound: `GA<3-padded type><args joined by ";">` (Aks.GameActions:24).

import { WireIn, WireOut } from "../../wire";

@WireIn({
  opcode: "GA",
  bodyOffset: 2,
  parse(body) {
    const inst = new GA();
    const parts = body.split(";");
    const id = Number.parseInt(parts[0] ?? "", 10);
    const type = Number.parseInt(parts[1] ?? "", 10);
    inst.actionId = Number.isNaN(id) ? 0 : id;
    inst.actionType = Number.isNaN(type) ? 0 : type;
    inst.sourceSpriteId = parts[2] ?? "";
    inst.args = parts.slice(3);
    return inst;
  },
})
export class GA {
  actionId: number;
  actionType: number;
  sourceSpriteId: string;
  args: string[];
}

@WireOut({
  opcode: "GA",
  serialize(m) {
    const out = m as GAOut;
    return out.actionType.toString().padStart(3, "0") + out.args.join(";");
  },
})
export class GAOut {
  actionType: number;
  args: ReadonlyArray<string | number>;
}
