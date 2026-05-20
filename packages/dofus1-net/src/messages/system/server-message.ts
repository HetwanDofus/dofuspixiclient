// M — Server Message (Aks.as:769, DataProcessor.as:59).
// Wire: `M<flavor:1><id><sep="|"><params;…><sep>?<callback>`
//   flavor "0" → preLogin cached message
//   flavor "1" → interactive popup with optional callback name

import { WireIn } from "../../wire";

export type ServerMessageKind = "preLogin" | "interactive";

@WireIn({
  opcode: "M",
  bodyOffset: 1,
  parse(body) {
    const inst = new ServerMessage();
    const flavor = body.charAt(0);
    const parts = body.slice(1).split("|");
    const id = Number.parseInt(parts[0] ?? "", 10);
    inst.id = Number.isNaN(id) ? 0 : id;
    inst.params = parts[1] ? parts[1].split(";") : [];
    if (flavor === "0") {
      inst.kind = "preLogin";
    } else {
      inst.kind = "interactive";
      if (parts[2] && parts[2].length > 0) inst.callbackName = parts[2];
    }
    return inst;
  },
})
export class ServerMessage {
  kind: ServerMessageKind;
  id: number;
  params: string[];
  callbackName?: string;
}
