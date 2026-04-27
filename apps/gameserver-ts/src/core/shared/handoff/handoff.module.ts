import { Global, Module } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";
import { HandoffCoordinator } from "@shared/handoff/handoff.coordinator";

@Global()
@Module({
  imports: [DiscoveryModule],
  providers: [HandoffCoordinator],
  exports: [HandoffCoordinator],
})
export class HandoffModule {}
