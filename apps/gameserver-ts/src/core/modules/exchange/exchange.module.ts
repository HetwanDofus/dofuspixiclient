import { BigStoreExpiryService } from "@modules/exchange/big-store.expiry.service";
import { BigStoreFlow } from "@modules/exchange/big-store.flow";
import { BigStoreFramesService } from "@modules/exchange/big-store.frames.service";
import { BigStoreRegistry } from "@modules/exchange/big-store.registry";
import { BigStoreRepository } from "@modules/exchange/big-store.repository";
import { ExchangeFramesService } from "@modules/exchange/exchange.frames.service";
import { ExchangeRegistryService } from "@modules/exchange/exchange.registry";
import { ExchangeSerializer } from "@modules/exchange/exchange.serializer";
import { ExchangeService } from "@modules/exchange/exchange.service";
import { HdvService } from "@modules/exchange/hdv.service";
import { StorageFlow } from "@modules/exchange/storage.flow";
import { TradeFlow } from "@modules/exchange/trade.flow";
import { TradeRegistryService } from "@modules/exchange/trade.registry";
import { FightModule } from "@modules/fight/fight.module";
import { InventoryModule } from "@modules/inventory/inventory.module";
import { ItemsModule } from "@modules/items/items.module";
import { NpcsModule } from "@modules/npcs/npcs.module";
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
    NpcsModule,
  ],
  providers: [
    ExchangeRegistryService,
    TradeRegistryService,
    ExchangeSerializer,
    ExchangeFramesService,
    StorageFlow,
    TradeFlow,
    BigStoreRepository,
    BigStoreRegistry,
    BigStoreFramesService,
    HdvService,
    BigStoreFlow,
    BigStoreExpiryService,
    ExchangeService,
  ],
  exports: [ExchangeService, ExchangeRegistryService, HdvService],
})
export class ExchangeModule {}
