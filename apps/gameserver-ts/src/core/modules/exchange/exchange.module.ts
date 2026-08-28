import { ExchangeFramesService } from "@modules/exchange/exchange.frames.service";
import { ExchangeRegistryService } from "@modules/exchange/exchange.registry";
import { ExchangeSerializer } from "@modules/exchange/exchange.serializer";
import { ExchangeService } from "@modules/exchange/exchange.service";
import { StorageFlow } from "@modules/exchange/storage.flow";
import { TradeFlow } from "@modules/exchange/trade.flow";
import { TradeRegistryService } from "@modules/exchange/trade.registry";
import { FightModule } from "@modules/fight/fight.module";
import { InventoryModule } from "@modules/inventory/inventory.module";
import { ItemsModule } from "@modules/items/items.module";
import { PlayerPresenceModule } from "@modules/player-presence/player-presence.module";
import { PlayersModule } from "@modules/players/players.module";
import { StatsModule } from "@modules/stats/stats.module";
import { Module } from "@nestjs/common";

@Module({
  imports: [
    ItemsModule,
    InventoryModule,
    StatsModule,
    FightModule,
    PlayersModule,
    PlayerPresenceModule,
  ],
  providers: [
    ExchangeRegistryService,
    TradeRegistryService,
    ExchangeSerializer,
    ExchangeFramesService,
    StorageFlow,
    TradeFlow,
    ExchangeService,
  ],
  exports: [ExchangeService, ExchangeRegistryService],
})
export class ExchangeModule {}
