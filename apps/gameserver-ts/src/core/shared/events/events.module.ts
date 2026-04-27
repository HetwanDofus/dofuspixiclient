import type { Env } from "@shared/config/env.schema";
import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DomainEventBus, NODE_ID } from "@shared/events/domain-event-bus";
import { RedisClusterTransport } from "@shared/events/redis-cluster-transport";

@Global()
@Module({
  providers: [
    DomainEventBus,
    {
      provide: NODE_ID,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        config.get("NODE_ID", { infer: true }) ?? `core-${process.pid}`,
    },
    {
      provide: "CLUSTER_TRANSPORT",
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const url = config.get("REDIS_URL", { infer: true });

        return url ? new RedisClusterTransport(url) : null;
      },
    },
  ],
  exports: [DomainEventBus, NODE_ID],
})
export class EventsModule {}
