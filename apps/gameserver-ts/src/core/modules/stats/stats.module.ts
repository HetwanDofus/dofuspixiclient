import { InventoryModule } from "@modules/inventory/inventory.module";
import { PlayersModule } from "@modules/players/players.module";
import { LifeRegenService } from "@modules/stats/life-regen.service";
import { StatsService } from "@modules/stats/stats.service";
import { Module } from "@nestjs/common";

@Module({
  imports: [InventoryModule, PlayersModule],
  providers: [StatsService, LifeRegenService],
  exports: [StatsService, LifeRegenService],
})
export class StatsModule {}
