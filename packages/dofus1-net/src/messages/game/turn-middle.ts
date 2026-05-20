// GTM — Turn Middle (Game.as:427, DataProcessor.as:417)
//
// Periodic mid-turn snapshot of every fighter's hp/ap/mp/cell. Verified
// against AraknemuHorizon's `TurnMiddle.java`:
//
//   `GTM|<id>;<dead?1:0>;[<hp>;<ap>;<mp>;<cell>;<unused>;<hpMax>]|...`
//
// When `dead=1` the row stops at the 2nd field; otherwise the 8 fields
// shown above are present. Index 6 is "not used by client" — left
// empty — and `hpMax` sits at index 7. Canonical AS2
// (`Game.as:line ~340` per the AraknemuHorizon comment) reads in the
// same order.

import { Composite, F, WireIn } from "../../wire";

@Composite({ separator: ";" })
export class FighterUpdate {
  @F.str(0) spriteId: string;
  @F.bool(1) dead: boolean;
  @F.int(2) hp: number;
  @F.int(3) ap: number;
  @F.int(4) mp: number;
  @F.int(5) cell: number;
  // Index 6 is intentionally skipped — server emits an empty cell
  // there and the canonical client doesn't read it.
  @F.int(7) hpMax: number;
}

@WireIn({ opcode: "GTM", bodyOffset: 4 })
export class GTM {
  @F.trailing(0, FighterUpdate) updates: FighterUpdate[];
}
