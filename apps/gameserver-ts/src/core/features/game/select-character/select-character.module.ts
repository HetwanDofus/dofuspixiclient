import { SelectCharacterHandler } from "@features/game/select-character/select-character.handler";
import { SelectCharacterRepository } from "@features/game/select-character/select-character.repository";
import { Module } from "@nestjs/common";

@Module({
  providers: [SelectCharacterHandler, SelectCharacterRepository],
})
export class SelectCharacterModule {}
