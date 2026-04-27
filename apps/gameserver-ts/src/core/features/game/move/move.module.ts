import { MoveHandler } from "@features/game/move/move.handler";
import { MapsModule } from "@modules/maps/maps.module";
import { PlayerPresenceModule } from "@modules/player-presence/player-presence.module";
import { Module } from "@nestjs/common";

@Module({
  imports: [MapsModule, PlayerPresenceModule],
  providers: [MoveHandler],
})
export class MoveModule {}
