import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { ClusterTransport } from "@shared/events/domain-event-bus";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { DomainEvent } from "@shared/events/domain-event";
import { DomainEventBus } from "@shared/events/domain-event-bus";

class LocalOnlyEvent extends DomainEvent {
  static readonly channel = "test.local";
  static readonly scope = "local" as const;
}

class ClusterOnlyEvent extends DomainEvent {
  static readonly channel = "test.cluster";
  static readonly scope = "cluster" as const;
}

class BothEvent extends DomainEvent {
  static readonly channel = "test.both";
  static readonly scope = "both" as const;
  constructor(public readonly payload: string) {
    super();
  }
}

type PublishCall = Parameters<ClusterTransport["publish"]>;

function fakeTransport() {
  const published: PublishCall[] = [];
  const subscribers = new Map<
    string,
    Array<
      (env: { channel: string; originNodeId: string; payload: unknown }) => void
    >
  >();

  const transport: ClusterTransport = {
    async publish(subject, envelope, delivery) {
      published.push([subject, envelope, delivery]);
      const handlers = subscribers.get(subject) ?? [];
      for (const h of handlers) {
        h(envelope);
      }
    },
    async subscribe(subject, handler) {
      const list = subscribers.get(subject) ?? [];
      list.push(handler);
      subscribers.set(subject, list);
      return () => {
        subscribers.set(
          subject,
          (subscribers.get(subject) ?? []).filter((h) => h !== handler)
        );
      };
    },
  };

  return { transport, published };
}

describe("DomainEventBus", () => {
  let emitter: EventEmitter2;

  beforeEach(() => {
    emitter = new EventEmitter2({ wildcard: true, delimiter: "." });
  });

  test("local-scoped event fires the local emitter, never publishes to cluster", async () => {
    const { transport, published } = fakeTransport();
    const bus = new DomainEventBus(emitter, "node-A", transport);
    const handler = mock(() => {});
    emitter.on(LocalOnlyEvent.channel, handler);

    await bus.emit(new LocalOnlyEvent());

    expect(handler).toHaveBeenCalledTimes(1);
    expect(published).toHaveLength(0);
  });

  test("cluster-scoped event publishes but does not fire local emitter on origin", async () => {
    const { transport, published } = fakeTransport();
    const bus = new DomainEventBus(emitter, "node-A", transport);
    const handler = mock(() => {});
    emitter.on(ClusterOnlyEvent.channel, handler);

    await bus.emit(new ClusterOnlyEvent());

    expect(handler).toHaveBeenCalledTimes(0);
    expect(published).toHaveLength(1);
    expect(published[0]?.[0]).toBe("cluster.test.cluster");
    expect(published[0]?.[1].originNodeId).toBe("node-A");
  });

  test("both-scoped event fires local and publishes to cluster", async () => {
    const { transport, published } = fakeTransport();
    const bus = new DomainEventBus(emitter, "node-A", transport);
    const handler = mock(() => {});
    emitter.on(BothEvent.channel, handler);

    await bus.emit(new BothEvent("hello"));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(published).toHaveLength(1);
  });

  test("bindClusterChannel delivers remote events locally and skips own echoes", async () => {
    const { transport } = fakeTransport();
    const bus = new DomainEventBus(emitter, "node-A", transport);
    const handler = mock(() => {});
    emitter.on(ClusterOnlyEvent.channel, handler);

    await bus.bindClusterChannel(ClusterOnlyEvent.channel);
    await bus.emit(new ClusterOnlyEvent());

    expect(handler).toHaveBeenCalledTimes(0);
  });

  test("remote cluster event triggers local handler on a subscribed node", async () => {
    const { transport } = fakeTransport();
    const busA = new DomainEventBus(emitter, "node-A", transport);

    const emitterB = new EventEmitter2({ wildcard: true, delimiter: "." });
    const busB = new DomainEventBus(emitterB, "node-B", transport);
    const handler = mock(() => {});
    emitterB.on(ClusterOnlyEvent.channel, handler);

    await busB.bindClusterChannel(ClusterOnlyEvent.channel);
    await busA.emit(new ClusterOnlyEvent());

    expect(handler).toHaveBeenCalledTimes(1);
  });

  test("missing cluster transport makes cluster emits a no-op", async () => {
    const bus = new DomainEventBus(emitter, "node-A", null);
    await expect(bus.emit(new ClusterOnlyEvent())).resolves.toBeUndefined();
  });
});
