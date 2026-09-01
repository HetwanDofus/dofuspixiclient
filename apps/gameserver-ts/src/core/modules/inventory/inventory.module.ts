import { AccessoriesService } from "@modules/inventory/accessories.service";
import { InventoryFramesService } from "@modules/inventory/inventory.frames.service";
import { InventoryRepository } from "@modules/inventory/inventory.repository";
import { InventoryService } from "@modules/inventory/inventory.service";
import { ItemPresentationCacheService } from "@modules/inventory/item-presentation.cache";
import { ItemTemplateCacheService } from "@modules/inventory/item-template.cache";
import { ItemsModule } from "@modules/items/items.module";
import { JobsModule } from "@modules/jobs/jobs.module";
import { LifeRegenModule } from "@modules/life-regen/life-regen.module";
import { PlayersModule } from "@modules/players/players.module";
import { Module } from "@nestjs/common";

@Module({
  imports: [PlayersModule, LifeRegenModule, ItemsModule, JobsModule],
  providers: [
    InventoryRepository,
    ItemTemplateCacheService,
    ItemPresentationCacheService,
    AccessoriesService,
    InventoryFramesService,
    InventoryService,
  ],
  exports: [
    InventoryRepository,
    ItemTemplateCacheService,
    ItemPresentationCacheService,
    AccessoriesService,
    InventoryFramesService,
    InventoryService,
  ],
})
export class InventoryModule {}
