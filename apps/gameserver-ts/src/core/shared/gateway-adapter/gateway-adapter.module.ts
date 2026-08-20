import { Global, Module } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";
import { SessionEvictionService } from "@shared/gateway-adapter/session-eviction.service";
import { SessionRegistry } from "@shared/gateway-adapter/session-registry";
import { WsRouter } from "@shared/gateway-adapter/ws-router";

@Global()
@Module({
  imports: [DiscoveryModule],
  providers: [
    WsRouter,
    SessionRegistry,
    GatewayFrameService,
    SessionEvictionService,
  ],
  exports: [
    WsRouter,
    SessionRegistry,
    GatewayFrameService,
    SessionEvictionService,
  ],
})
export class GatewayAdapterModule {}
