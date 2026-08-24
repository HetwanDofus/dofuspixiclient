import { InventoryModule } from "@modules/inventory/inventory.module";
import { LifeRegenModule } from "@modules/life-regen/life-regen.module";
import { PlayersModule } from "@modules/players/players.module";
import { StatsService } from "@modules/stats/stats.service";
import { Module } from "@nestjs/common";

@Module({
  imports: [InventoryModule, PlayersModule, LifeRegenModule],
  providers: [StatsService],
  // Re-exporting `LifeRegenModule` (rather than declaring `LifeRegenService`
  // as a local provider) keeps `fight-join`/`fight-start` — which import
  // this module for it — working unchanged; see `LifeRegenModule`'s
  // comment for why it moved out of here.
  exports: [StatsService, LifeRegenModule],
})
export class StatsModule {}
