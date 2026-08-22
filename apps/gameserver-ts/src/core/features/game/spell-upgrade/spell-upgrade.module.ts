import { SpellUpgradeHandler } from "@features/game/spell-upgrade/spell-upgrade.handler";
import { PlayersModule } from "@modules/players/players.module";
import { SpellsModule } from "@modules/spells/spells.module";
import { StatsModule } from "@modules/stats/stats.module";
import { Module } from "@nestjs/common";

@Module({
  imports: [PlayersModule, SpellsModule, StatsModule],
  providers: [SpellUpgradeHandler],
})
export class SpellUpgradeModule {}
