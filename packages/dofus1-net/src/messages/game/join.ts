// GJ — Game Join (Game.as:137, DataProcessor.as:299)
// Wire: <state>|<cancelEnabled>|<showChallengeMenu>|<isSpectator>|<durationMs>|<fightType>

import { F, WireIn } from "../../wire";

@WireIn({ opcode: "GJ", bodyOffset: 3 })
export class GJ {
  @F.int(0) state: number;
  @F.bool(1) cancelEnabled: boolean;
  @F.bool(2) showChallengeMenu: boolean;
  @F.bool(3) isSpectator: boolean;
  @F.int(4) durationMs: number;
  @F.int(5) fightType: number;
}
