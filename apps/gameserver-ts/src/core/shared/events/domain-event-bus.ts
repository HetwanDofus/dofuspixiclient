// Unified event bus. Routes based on static metadata on the event class:
//   - local   → EventEmitter2 (same-node sagas)
//   - cluster → NATS/Redis (other-node subscribers)        [stub: TODO wire]
//   - both    → both transports
//
// Loop guard: cluster envelopes carry originNodeId; receivers skip echoes.

import type { DomainEvent, DomainEventCtor } from "@shared/events/domain-event";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";

export const NODE_ID = Symbol.for("dofus:nodeId");

type ClusterEnvelope = {
  channel: string;
  originNodeId: string;
  payload: unknown;
};

export interface ClusterTransport {
  publish(
    subject: string,
    envelope: ClusterEnvelope,
    delivery: "at-most-once" | "at-least-once"
  ): Promise<void>;
  subscribe(
    subject: string,
    handler: (env: ClusterEnvelope) => void
  ): Promise<() => void>;
}

@Injectable()
export class DomainEventBus {
  private readonly logger = new Logger(DomainEventBus.name);

  constructor(
    private readonly local: EventEmitter2,
    @Inject(NODE_ID) private readonly nodeId: string,
    // When null, cluster emits are no-ops. Inject a real transport (NATS,
    // Redis pub/sub) in production. Left optional so the scaffold runs.
    @Inject("CLUSTER_TRANSPORT")
    private readonly cluster: ClusterTransport | null
  ) {}

  async emit<T extends DomainEvent>(event: T): Promise<void> {
    const ctor = event.constructor as unknown as DomainEventCtor<T>;
    const { channel, scope, delivery } = ctor;

    if (!channel || !scope) {
      throw new Error(`event ${ctor.name} missing static channel/scope`);
    }

    if (scope === "local" || scope === "both") {
      this.local.emit(channel, event);
    }

    if ((scope === "cluster" || scope === "both") && this.cluster) {
      try {
        await this.cluster.publish(
          `cluster.${channel}`,
          { channel, originNodeId: this.nodeId, payload: event },
          delivery
        );
      } catch (err) {
        this.logger.error(
          `cluster publish failed for ${channel}`,
          err as Error
        );
      }
    }
  }

  // Bridge cluster → local. Call once at boot for each channel the node cares
  // about (subscribe only to resources you own: fights, maps, etc.).
  async bindClusterChannel(channel: string): Promise<() => void> {
    if (!this.cluster) {
      return () => undefined;
    }

    return this.cluster.subscribe(`cluster.${channel}`, (env) => {
      if (env.originNodeId === this.nodeId) {
        return; // loop guard
      }

      this.local.emit(env.channel, env.payload);
    });
  }
}
