import { SpellMoveHandler } from "@features/game/spell-move/spell-move.handler";
import { SpellsModule } from "@modules/spells/spells.module";
import { Module } from "@nestjs/common";

@Module({
  imports: [SpellsModule],
  providers: [SpellMoveHandler],
})
export class SpellMoveModule {}
