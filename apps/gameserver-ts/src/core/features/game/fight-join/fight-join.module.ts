import { FightJoinHandler } from "@features/game/fight-join/fight-join.handler";
import { PlayerPresenceModule } from "@modules/player-presence/player-presence.module";
import { PlayersModule } from "@modules/players/players.module";
import { Module } from "@nestjs/common";

@Module({
  imports: [PlayerPresenceModule, PlayersModule],
  providers: [FightJoinHandler],
})
export class FightJoinModule {}
