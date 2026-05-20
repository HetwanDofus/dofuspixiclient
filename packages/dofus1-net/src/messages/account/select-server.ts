// AX — Select server (Account.as:94 out / 740 in, DataProcessor.as:211).
// Inbound packs `<ipHex:8><portB64:3><ticket>`; outbound is `AX<serverId>`.

import { F, WireIn, WireOut } from "../../wire";

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function decode64(ch: string): number {
  const i = B64.indexOf(ch);
  return i < 0 ? 0 : i;
}

function decodeIp(hex8: string): string {
  const octets: number[] = [];
  for (let i = 0; i + 1 < hex8.length; i += 2) {
    const a = hex8.charCodeAt(i) - 48;
    const b = hex8.charCodeAt(i + 1) - 48;
    octets.push(((a & 0x0f) << 4) | (b & 0x0f));
  }
  return octets.join(".");
}

function decodePort(b3: string): number {
  const a = decode64(b3.charAt(0)) & 0x3f;
  const b = decode64(b3.charAt(1)) & 0x3f;
  const c = decode64(b3.charAt(2)) & 0x3f;
  return (a << 12) | (b << 6) | c;
}

@WireIn({
  opcode: "AX",
  bodyOffset: 3,
  parse(body, errorFlag) {
    const inst = new AX();
    if (errorFlag) {
      // `AXE<char>` — server selection failed (full server, ban,
      // etc.). AraknemuHorizon emits 'F' (FULL) or 'r' (CANT_SELECT);
      // canonical 1.29 has a wider set decoded by Account.as#onServerSelectError.
      inst.ok = false;
      inst.errorCode = body.charAt(0) || "";
      inst.ip = "";
      inst.port = 0;
      inst.ticket = "";
      return inst;
    }
    inst.ok = true;
    inst.errorCode = "";
    inst.ip = decodeIp(body.substr(0, 8));
    inst.port = decodePort(body.substr(8, 3));
    inst.ticket = body.slice(11);
    return inst;
  },
})
export class AX {
  ok: boolean;
  /** Single error char when `ok=false`. Empty on success. */
  errorCode: string;
  ip: string;
  port: number;
  ticket: string;
}

@WireOut({ opcode: "AX" })
export class AXOut {
  @F.int(0) serverId: number;
}
