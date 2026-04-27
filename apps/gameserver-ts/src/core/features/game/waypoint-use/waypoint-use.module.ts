import { WaypointUseHandler } from "@features/game/waypoint-use/waypoint-use.handler";
import { WaypointsModule } from "@modules/waypoints/waypoints.module";
import { Module } from "@nestjs/common";

@Module({
  imports: [WaypointsModule],
  providers: [WaypointUseHandler],
})
export class WaypointUseModule {}
