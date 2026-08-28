import { ExchangeModule } from "@modules/exchange/exchange.module";
import { InteractiveObjectsRepository } from "@modules/interactive-objects/interactive-objects.repository";
import { InteractiveObjectsService } from "@modules/interactive-objects/interactive-objects.service";
import { ItemsModule } from "@modules/items/items.module";
import { MapsModule } from "@modules/maps/maps.module";
import { PlayerPresenceModule } from "@modules/player-presence/player-presence.module";
import { WaypointsModule } from "@modules/waypoints/waypoints.module";
import { Module } from "@nestjs/common";

@Module({
  imports: [
    MapsModule,
    PlayerPresenceModule,
    WaypointsModule,
    ItemsModule,
    ExchangeModule,
  ],
  providers: [InteractiveObjectsRepository, InteractiveObjectsService],
  exports: [InteractiveObjectsService],
})
export class InteractiveObjectsModule {}
