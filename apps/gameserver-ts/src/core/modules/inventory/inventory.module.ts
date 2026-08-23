import { AccessoriesService } from "@modules/inventory/accessories.service";
import { InventoryFramesService } from "@modules/inventory/inventory.frames.service";
import { InventoryRepository } from "@modules/inventory/inventory.repository";
import { ItemTemplateCacheService } from "@modules/inventory/item-template.cache";
import { Module } from "@nestjs/common";

@Module({
  providers: [
    InventoryRepository,
    ItemTemplateCacheService,
    AccessoriesService,
    InventoryFramesService,
  ],
  exports: [
    InventoryRepository,
    ItemTemplateCacheService,
    AccessoriesService,
    InventoryFramesService,
  ],
})
export class InventoryModule {}
