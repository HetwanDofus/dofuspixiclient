import { ShortcutsHandler } from "@features/game/shortcuts/shortcuts.handler";
import { ShortcutsModule as ShortcutsDomainModule } from "@modules/shortcuts/shortcuts.module";
import { Module } from "@nestjs/common";

@Module({
  imports: [ShortcutsDomainModule],
  providers: [ShortcutsHandler],
})
export class ShortcutsSliceModule {}
