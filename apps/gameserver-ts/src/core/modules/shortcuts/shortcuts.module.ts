import { InventoryModule } from "@modules/inventory/inventory.module";
import { ShortcutsFramesService } from "@modules/shortcuts/shortcuts.frames.service";
import { ShortcutsRepository } from "@modules/shortcuts/shortcuts.repository";
import { ShortcutsService } from "@modules/shortcuts/shortcuts.service";
import { Module } from "@nestjs/common";

@Module({
  imports: [InventoryModule],
  providers: [ShortcutsRepository, ShortcutsFramesService, ShortcutsService],
  exports: [ShortcutsRepository, ShortcutsFramesService, ShortcutsService],
})
export class ShortcutsModule {}
