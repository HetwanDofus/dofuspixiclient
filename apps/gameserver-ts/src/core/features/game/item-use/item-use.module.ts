import { ItemUseHandler } from "@features/game/item-use/item-use.handler";
import { InventoryModule } from "@modules/inventory/inventory.module";
import { StatsModule } from "@modules/stats/stats.module";
import { Module } from "@nestjs/common";

@Module({
  imports: [InventoryModule, StatsModule],
  providers: [ItemUseHandler],
})
export class ItemUseModule {}
