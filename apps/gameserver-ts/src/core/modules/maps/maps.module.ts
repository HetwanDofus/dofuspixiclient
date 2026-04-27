import { MapCacheService } from "@modules/maps/maps.cache.service";
import { MapsRepository } from "@modules/maps/maps.repository";
import { MapTransitionService } from "@modules/maps/maps.transition.service";
import { PlayerPresenceModule } from "@modules/player-presence/player-presence.module";
import { PlayersModule } from "@modules/players/players.module";
import { Module } from "@nestjs/common";

@Module({
  imports: [PlayersModule, PlayerPresenceModule],
  providers: [MapsRepository, MapCacheService, MapTransitionService],
  exports: [MapsRepository, MapCacheService, MapTransitionService],
})
export class MapsModule {}
