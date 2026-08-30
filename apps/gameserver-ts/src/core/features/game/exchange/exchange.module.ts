import { ExchangeHandler } from "@features/game/exchange/exchange.handler";
import { ExchangeModule as ExchangeDomainModule } from "@modules/exchange/exchange.module";
import { NpcsModule } from "@modules/npcs/npcs.module";
import { PlayerPresenceModule } from "@modules/player-presence/player-presence.module";
import { Module } from "@nestjs/common";

@Module({
  imports: [ExchangeDomainModule, NpcsModule, PlayerPresenceModule],
  providers: [ExchangeHandler],
})
export class ExchangeSliceModule {}
