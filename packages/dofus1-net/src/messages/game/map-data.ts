// GDM — Map Data (Game.as:542, DataProcessor.as:354)
// Wire: <mapId>|<dateTime>|<decryptKey>

import { F, WireIn } from "../../wire";

@WireIn({ opcode: "GDM", bodyOffset: 4 })
export class GDM {
  @F.str(0) mapId: string;
  @F.str(1) dateTime: string;
  @F.str(2) decryptKey: string;
}
