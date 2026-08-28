import { InventoryModule } from "@modules/inventory/inventory.module";
import { MapsModule } from "@modules/maps/maps.module";
import { MapNpcService } from "@modules/npcs/map-npc.service";
import { NpcDialogRepository } from "@modules/npcs/npc-dialog.repository";
import { NpcDialogService } from "@modules/npcs/npc-dialog.service";
import { NpcDialogSessionService } from "@modules/npcs/npc-dialog.session";
import { NpcWanderService } from "@modules/npcs/npc-wander.service";
import { NpcsRepository } from "@modules/npcs/npcs.repository";
import { PlayerPresenceModule } from "@modules/player-presence/player-presence.module";
import { Module } from "@nestjs/common";

@Module({
  imports: [InventoryModule, MapsModule, PlayerPresenceModule],
  providers: [
    NpcsRepository,
    MapNpcService,
    NpcDialogRepository,
    NpcDialogService,
    NpcDialogSessionService,
    NpcWanderService,
  ],
  exports: [
    NpcsRepository,
    MapNpcService,
    NpcDialogService,
    NpcDialogSessionService,
  ],
})
export class NpcsModule {}
