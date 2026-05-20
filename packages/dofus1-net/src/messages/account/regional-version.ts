// AV — Regional version (Account.as:175 out / 224 in, DataProcessor.as:250)

import { F, WireIn, WireOut } from "../../wire";

@WireIn({ opcode: "AV", bodyOffset: 2 })
export class AV {
  @F.int(0) version: number;
}

/** Outbound `AV` — request the server's regional version. Empty body. */
@WireOut({ opcode: "AV" })
export class AVOut {}
