import { StatBoostHandler } from "@features/game/stat-boost/stat-boost.handler";
import { PlayersModule } from "@modules/players/players.module";
import { StatsModule } from "@modules/stats/stats.module";
import { Module } from "@nestjs/common";

@Module({
  imports: [PlayersModule, StatsModule],
  providers: [StatBoostHandler],
})
export class StatBoostModule {}
