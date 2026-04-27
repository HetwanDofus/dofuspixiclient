import { GetMapDataHandler } from "@features/game/get-map-data/get-map-data.handler";
import { MapsModule } from "@modules/maps/maps.module";
import { PlayersModule } from "@modules/players/players.module";
import { Module } from "@nestjs/common";

@Module({
  imports: [MapsModule, PlayersModule],
  providers: [GetMapDataHandler],
})
export class GetMapDataModule {}
