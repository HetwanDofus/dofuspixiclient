// Redis pub/sub implementation of ClusterTransport.
//
// Subjects: "cluster.<channel>" (e.g. "cluster.fight.delta"). Two Redis
// connections per instance: one for pub, one for sub (ioredis requires a
// dedicated subscriber connection).
//
// Envelope format is JSON for the scaffold. Swap for proto ClusterEnvelope
// in prod (payload stays bytes; wrapper gets typed).

import type { ClusterTransport } from "@shared/events/domain-event-bus";
import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";

type Wire = { channel: string; originNodeId: string; payload: unknown };

@Injectable()
export class RedisClusterTransport
  implements ClusterTransport, OnModuleDestroy
{
  private readonly logger = new Logger(RedisClusterTransport.name);
  private readonly pub: Redis;
  private readonly sub: Redis;
  private readonly handlers = new Map<
    string,
    Set<
      (env: { channel: string; originNodeId: string; payload: unknown }) => void
    >
  >();

  constructor(redisUrl: string) {
    this.pub = new Redis(redisUrl, { lazyConnect: false });
    this.sub = new Redis(redisUrl, { lazyConnect: false });
    this.sub.on("message", (subject, msg) => this.dispatch(subject, msg));
    this.sub.on("error", (e) =>
      this.logger.error(`redis sub error: ${e.message}`)
    );
    this.pub.on("error", (e) =>
      this.logger.error(`redis pub error: ${e.message}`)
    );
  }

  async publish(
    subject: string,
    envelope: { channel: string; originNodeId: string; payload: unknown },
    _delivery: "at-most-once" | "at-least-once"
  ): Promise<void> {
    const wire: Wire = envelope;
    // TODO: at-least-once = push to a Redis Stream + consumer group instead.
    await this.pub.publish(subject, JSON.stringify(wire));
  }

  async subscribe(
    subject: string,
    handler: (env: {
      channel: string;
      originNodeId: string;
      payload: unknown;
    }) => void
  ): Promise<() => void> {
    let set = this.handlers.get(subject);

    if (!set) {
      set = new Set();
      this.handlers.set(subject, set);

      await this.sub.subscribe(subject);
    }

    set.add(handler);

    return () => {
      set?.delete(handler);
      if (set?.size === 0) {
        this.handlers.delete(subject);
        void this.sub.unsubscribe(subject);
      }
    };
  }

  private dispatch(subject: string, msg: string) {
    const set = this.handlers.get(subject);

    if (!set || set.size === 0) {
      return;
    }

    let wire: Wire;

    try {
      wire = JSON.parse(msg) as Wire;
    } catch (e) {
      this.logger.warn(
        `bad cluster msg on ${subject}: ${(e as Error).message}`
      );
      return;
    }

    for (const h of set) {
      try {
        h(wire);
      } catch (e) {
        this.logger.error(`cluster handler threw on ${subject}`, e as Error);
      }
    }
  }

  async onModuleDestroy() {
    await Promise.all([this.pub.quit(), this.sub.quit()]);
  }
}
