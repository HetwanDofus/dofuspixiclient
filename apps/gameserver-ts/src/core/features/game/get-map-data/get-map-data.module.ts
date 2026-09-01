import { GetMapDataHandler } from "@features/game/get-map-data/get-map-data.handler";
import { HarvestModule } from "@modules/harvest/harvest.module";
import { MapsModule } from "@modules/maps/maps.module";
import { PlayersModule } from "@modules/players/players.module";
import { Module } from "@nestjs/common";

@Module({
  imports: [MapsModule, PlayersModule, HarvestModule],
  providers: [GetMapDataHandler],
})
export class GetMapDataModule {}
