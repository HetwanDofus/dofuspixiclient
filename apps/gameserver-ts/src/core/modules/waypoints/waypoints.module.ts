import { MapsModule } from "@modules/maps/maps.module";
import { PlayerPresenceModule } from "@modules/player-presence/player-presence.module";
import { PlayersModule } from "@modules/players/players.module";
import { WaypointsRepository } from "@modules/waypoints/waypoints.repository";
import { WaypointsService } from "@modules/waypoints/waypoints.service";
import { Module } from "@nestjs/common";

@Module({
  imports: [MapsModule, PlayersModule, PlayerPresenceModule],
  providers: [WaypointsRepository, WaypointsService],
  exports: [WaypointsService],
})
export class WaypointsModule {}
