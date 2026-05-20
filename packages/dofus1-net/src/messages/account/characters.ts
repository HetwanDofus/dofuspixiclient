// AL — Account Characters List (Account.as:568, DataProcessor.as:199)
// Wire: <subscriberFlag>|<count>|<id;name;level;gfx;c1;c2;c3;accessories…>|…

import { Composite, F, WireIn } from "../../wire";

@Composite({ separator: ";" })
export class CharacterEntry {
  @F.str(0) id: string;
  @F.str(1) name: string;
  @F.int(2, { default: 1 }) level: number;
  @F.int(3) gfxId: number;
  // Colors are emitted as lowercase hex (e.g. "ff8080") per
  // AraknemuHorizon's `Colors.toHexString(";")`. Parse as base-16
  // so the look-string composer gets the canonical numeric value.
  @F.int16(4, { default: -1 }) color1: number;
  @F.int16(5, { default: -1 }) color2: number;
  @F.int16(6, { default: -1 }) color3: number;
  /** Equipment + extras, semicolon-joined remainder of the row. */
  @F.rest(7) accessories: string;
}

@WireIn({ opcode: "AL", bodyOffset: 3 })
export class AL {
  @F.int(0) subscriberFlag: number;
  @F.int(1) count: number;
  @F.trailing(2, CharacterEntry) characters: CharacterEntry[];
}
