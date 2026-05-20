// AS — Select character (Account.as:102 out / 879 in, DataProcessor.as:220).
// Inbound: `id|name|level|guild|sex|gfx|c1|c2|c3|items` (bodyOffset=4).
// Outbound: `AS<characterId>`.

import { F, WireIn, WireOut } from "../../wire";

@WireIn({ opcode: "AS", bodyOffset: 4 })
export class AS {
  @F.str(0) id: string;
  @F.str(1) name: string;
  @F.int(2, { default: 1 }) level: number;
  /** AraknemuHorizon emits the race ordinal in this slot (canonical
   *  1.29 used it for guild). Kept as raw string so consumers can
   *  fork by emulator without reparse. */
  @F.str(3) guild: string;
  @F.int(4) sex: number;
  @F.int(5) gfxId: number;
  // Colors are hex strings on the wire (see CharacterEntry).
  @F.int16(6, { default: -1 }) color1: number;
  @F.int16(7, { default: -1 }) color2: number;
  @F.int16(8, { default: -1 }) color3: number;
  @F.str(9) items: string;
}

@WireOut({ opcode: "AS" })
export class ASOut {
  @F.str(0) characterId: string;
}
