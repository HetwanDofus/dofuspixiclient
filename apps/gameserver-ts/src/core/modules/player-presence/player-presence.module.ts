import { PendingMovesService } from "@modules/player-presence/player-presence.pending-moves.service";
import { PlayerPresenceService } from "@modules/player-presence/player-presence.service";
import { Module } from "@nestjs/common";

@Module({
  providers: [PlayerPresenceService, PendingMovesService],
  exports: [PlayerPresenceService, PendingMovesService],
})
export class PlayerPresenceModule {}
