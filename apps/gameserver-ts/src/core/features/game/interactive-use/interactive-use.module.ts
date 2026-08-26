import { InteractiveUseHandler } from "@features/game/interactive-use/interactive-use.handler";
import { InteractiveObjectsModule } from "@modules/interactive-objects/interactive-objects.module";
import { Module } from "@nestjs/common";

@Module({
  imports: [InteractiveObjectsModule],
  providers: [InteractiveUseHandler],
})
export class InteractiveUseModule {}
