// GP — Position Start (Game.as:192, DataProcessor.as:302)
// Wire: <team1Cells>|<team2Cells>|<playerTeam>
// `team*Cells` are base64-paired strings — kept raw; grid layer
// decodes via its own base64 alphabet.

import { F, WireIn } from "../../wire";

@WireIn({ opcode: "GP", bodyOffset: 2 })
export class GP {
  @F.str(0) team1Cells: string;
  @F.str(1) team2Cells: string;
  @F.int(2) playerTeam: number;
}
