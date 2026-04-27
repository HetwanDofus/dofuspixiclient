import { CharacterListHandler } from "@features/game/character-list/character-list.handler";
import { CharacterListRepository } from "@features/game/character-list/character-list.repository";
import { Module } from "@nestjs/common";

@Module({
  providers: [CharacterListHandler, CharacterListRepository],
})
export class CharacterListModule {}
