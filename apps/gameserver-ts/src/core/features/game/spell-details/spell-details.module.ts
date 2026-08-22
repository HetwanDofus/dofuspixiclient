import { SpellDetailsHandler } from "@features/game/spell-details/spell-details.handler";
import { SpellsModule } from "@modules/spells/spells.module";
import { Module } from "@nestjs/common";

@Module({
  imports: [SpellsModule],
  providers: [SpellDetailsHandler],
})
export class SpellDetailsModule {}
