import { LifeRegenService } from "@modules/life-regen/life-regen.service";
import { PlayersModule } from "@modules/players/players.module";
import { Module } from "@nestjs/common";

/**
 * Its own module rather than living inside `StatsModule` (where it used
 * to) because `InventoryService` needs it too — to resolve current life
 * before applying a healing item's effect — and `StatsModule` imports
 * `InventoryModule`. Wiring `LifeRegenService` through `StatsModule`
 * would make that a cycle; both now depend on this instead.
 */
@Module({
  imports: [PlayersModule],
  providers: [LifeRegenService],
  exports: [LifeRegenService],
})
export class LifeRegenModule {}
