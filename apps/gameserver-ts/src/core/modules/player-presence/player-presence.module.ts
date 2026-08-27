import { InventoryModule } from "@modules/inventory/inventory.module";
import { PlayerLookService } from "@modules/player-presence/player-presence.look.service";
import { PendingMovesService } from "@modules/player-presence/player-presence.pending-moves.service";
import { PlayerPresenceService } from "@modules/player-presence/player-presence.service";
import { Module } from "@nestjs/common";

@Module({
  imports: [InventoryModule],
  providers: [PlayerPresenceService, PendingMovesService, PlayerLookService],
  exports: [PlayerPresenceService, PendingMovesService, PlayerLookService],
})
export class PlayerPresenceModule {}
