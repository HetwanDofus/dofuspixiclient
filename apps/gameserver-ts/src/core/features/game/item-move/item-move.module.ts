import { ItemMoveHandler } from "@features/game/item-move/item-move.handler";
import { InventoryModule } from "@modules/inventory/inventory.module";
import { PlayerPresenceModule } from "@modules/player-presence/player-presence.module";
import { StatsModule } from "@modules/stats/stats.module";
import { Module } from "@nestjs/common";

@Module({
  imports: [InventoryModule, StatsModule, PlayerPresenceModule],
  providers: [ItemMoveHandler],
})
export class ItemMoveModule {}
