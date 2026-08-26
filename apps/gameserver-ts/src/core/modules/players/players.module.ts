import { PlayersProgressionService } from "@modules/players/players.progression.service";
import { PlayersRepository } from "@modules/players/players.repository";
import { SpellsModule } from "@modules/spells/spells.module";
import { Module } from "@nestjs/common";

@Module({
  imports: [SpellsModule],
  providers: [PlayersRepository, PlayersProgressionService],
  exports: [PlayersRepository, PlayersProgressionService],
})
export class PlayersModule {}
