import { SpellsRepository } from "@modules/spells/spells.repository";
import { SpellsService } from "@modules/spells/spells.service";
import { Module } from "@nestjs/common";

@Module({
  providers: [SpellsRepository, SpellsService],
  exports: [SpellsService, SpellsRepository],
})
export class SpellsModule {}
