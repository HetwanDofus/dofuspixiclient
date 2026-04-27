import { ExchangeTicketHandler } from "@features/game/exchange-ticket/exchange-ticket.handler";
import { ExchangeTicketRepository } from "@features/game/exchange-ticket/exchange-ticket.repository";
import { Module } from "@nestjs/common";

@Module({
  providers: [ExchangeTicketHandler, ExchangeTicketRepository],
})
export class ExchangeTicketModule {}
