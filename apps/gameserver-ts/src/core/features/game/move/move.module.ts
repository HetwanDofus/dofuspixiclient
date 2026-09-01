import { MoveHandler } from "@features/game/move/move.handler";
import { ExchangeModule } from "@modules/exchange/exchange.module";
import { HarvestModule } from "@modules/harvest/harvest.module";
import { MapsModule } from "@modules/maps/maps.module";
import { PlayerPresenceModule } from "@modules/player-presence/player-presence.module";
import { Module } from "@nestjs/common";

@Module({
  // `ExchangeModule` only for the movement block: a trade pins both
  // players in place, and this is the one place a walk is authorised.
  imports: [MapsModule, PlayerPresenceModule, ExchangeModule, HarvestModule],
  providers: [MoveHandler],
})
export class MoveModule {}
