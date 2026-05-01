import { FightStartService } from "@features/game/fight-start/fight-start.service";
import { MonstersModule } from "@modules/monsters/monsters.module";
import { PlayerPresenceModule } from "@modules/player-presence/player-presence.module";
import { PlayersModule } from "@modules/players/players.module";
import { SpellsModule } from "@modules/spells/spells.module";
import { StatsModule } from "@modules/stats/stats.module";
import { Module } from "@nestjs/common";

@Module({
  imports: [
    PlayersModule,
    SpellsModule,
    PlayerPresenceModule,
    StatsModule,
    MonstersModule,
  ],
  providers: [FightStartService],
  exports: [FightStartService],
})
export class FightStartModule {}
