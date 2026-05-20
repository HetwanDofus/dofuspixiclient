// WC — Waypoint UI open (Waypoints.as:17, DataProcessor.as:986)
// Wire: <currentMapId>|<wpId;wpLevel>|<…>|…

import { Composite, F, WireIn } from "../../wire";

@Composite({ separator: ";" })
export class WaypointEntry {
  @F.int(0) id: number;
  @F.int(1) level: number;
}

@WireIn({ opcode: "WC", bodyOffset: 2 })
export class WC {
  @F.int(0) currentMapId: number;
  @F.trailing(1, WaypointEntry) waypoints: WaypointEntry[];
}
