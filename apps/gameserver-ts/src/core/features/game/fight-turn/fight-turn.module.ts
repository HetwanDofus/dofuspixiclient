import { FightTurnHandler } from "@features/game/fight-turn/fight-turn.handler";
import { SpellsModule } from "@modules/spells/spells.module";
import { Module } from "@nestjs/common";

@Module({
  imports: [SpellsModule],
  providers: [FightTurnHandler],
})
export class FightTurnModule {}
