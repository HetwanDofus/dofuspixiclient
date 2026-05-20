// cM — Chat Message (Chat.as:197, DataProcessor.as:443).
// Inbound (bodyOffset=3): `<channel:1><rest>`
// Outbound: `cM<channel><recipientOrEmpty>|<message>`

import { WireIn, WireOut } from "../../wire";

@WireIn({
  opcode: "cM",
  bodyOffset: 3,
  parse(body) {
    const inst = new CM();
    inst.channel = body.charAt(0);
    inst.raw = body.slice(1);
    return inst;
  },
})
export class CM {
  channel: string;
  /** Pipe-separated metadata trailing the channel char. */
  raw: string;
}

@WireOut({
  opcode: "cM",
  serialize(m) {
    const out = m as CMOut;
    return out.channel + out.recipient + "|" + out.message;
  },
})
export class CMOut {
  channel: string;
  recipient: string;
  message: string;
}
