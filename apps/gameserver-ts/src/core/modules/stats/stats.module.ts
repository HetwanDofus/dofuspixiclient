import { InventoryModule } from "@modules/inventory/inventory.module";
import { PlayersModule } from "@modules/players/players.module";
import { StatsService } from "@modules/stats/stats.service";
import { Module } from "@nestjs/common";

@Module({
  imports: [InventoryModule, PlayersModule],
  providers: [StatsService],
  exports: [StatsService],
})
export class StatsModule {}
