import { ContainerKamasRepository } from "@modules/items/container-kamas.repository";
import { ItemLedgerRepository } from "@modules/items/item-ledger.repository";
import { ItemTransferService } from "@modules/items/item-transfer.service";
import { ItemsRepository } from "@modules/items/items.repository";
import { KamasTransferService } from "@modules/items/kamas-transfer.service";
import { PlayersModule } from "@modules/players/players.module";
import { Module } from "@nestjs/common";

/**
 * Item instances and the moves between containers.
 *
 * Deliberately below `InventoryModule` rather than inside it: an
 * inventory is one container among several, and the bank, a chest, a
 * stall and an auction house all need the move primitive without
 * needing anything about equipment rules or pods.
 */
@Module({
  imports: [PlayersModule],
  providers: [
    ItemsRepository,
    ItemLedgerRepository,
    ContainerKamasRepository,
    ItemTransferService,
    KamasTransferService,
  ],
  exports: [
    ItemsRepository,
    ItemLedgerRepository,
    ContainerKamasRepository,
    ItemTransferService,
    KamasTransferService,
  ],
})
export class ItemsModule {}
