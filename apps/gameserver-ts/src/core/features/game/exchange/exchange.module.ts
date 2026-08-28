import { ExchangeHandler } from "@features/game/exchange/exchange.handler";
import { ExchangeModule as ExchangeDomainModule } from "@modules/exchange/exchange.module";
import { Module } from "@nestjs/common";

@Module({
  imports: [ExchangeDomainModule],
  providers: [ExchangeHandler],
})
export class ExchangeSliceModule {}
