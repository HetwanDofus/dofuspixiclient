// r — Random ping (DataProcessor.as:56-57).
// Inbound: `r<4-char-prefix><token>`.
// Outbound: `rpong<token>` — echo. The send opcode is "rp" with "ong"
// prepended in `serialize`.

import { F, WireIn, WireOut } from "../../wire";

@WireIn({ opcode: "r", bodyOffset: 5 })
export class RandomPing {
  @F.str(0) token: string;
}

@WireOut({
  opcode: "rp",
  serialize(m) {
    return "ong" + (m as RandomPingOut).token;
  },
})
export class RandomPingOut {
  token: string;
}
