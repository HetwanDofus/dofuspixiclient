import { FightChallengeHandler } from "@features/game/fight-challenge/fight-challenge.handler";
import { FightStartModule } from "@features/game/fight-start/fight-start.module";
import { MapsModule } from "@modules/maps/maps.module";
import { PlayerPresenceModule } from "@modules/player-presence/player-presence.module";
import { Module } from "@nestjs/common";

@Module({
  imports: [FightStartModule, MapsModule, PlayerPresenceModule],
  providers: [FightChallengeHandler],
})
export class FightChallengeModule {}
