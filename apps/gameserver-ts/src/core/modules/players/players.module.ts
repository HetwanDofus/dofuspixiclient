import { PlayersRepository } from "@modules/players/players.repository";
import { Module } from "@nestjs/common";

@Module({
  providers: [PlayersRepository],
  exports: [PlayersRepository],
})
export class PlayersModule {}
