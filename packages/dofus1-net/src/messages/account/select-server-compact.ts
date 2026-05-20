// AY — Select server, compact text variant (Account.as:740 with bUseIp=false,
// DataProcessor.as:214). Wire: `<ip>:<port>;<ticket>`.

import { WireIn } from "../../wire";

@WireIn({
  opcode: "AY",
  bodyOffset: 3,
  parse(body) {
    const inst = new AY();
    const [ipPort = "", ticket = ""] = body.split(";");
    const [ip = "", portStr = ""] = ipPort.split(":");
    inst.ip = ip;
    const n = Number.parseInt(portStr, 10);
    inst.port = Number.isNaN(n) ? 0 : n;
    inst.ticket = ticket;
    return inst;
  },
})
export class AY {
  ip: string;
  port: number;
  ticket: string;
}
