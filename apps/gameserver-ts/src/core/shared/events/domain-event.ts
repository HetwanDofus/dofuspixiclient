export type EventScope = "local" | "cluster" | "both";
export type EventDelivery = "at-most-once" | "at-least-once";

// Type-level marker + holder for per-event static routing metadata. Subclasses
// declare `channel` / `scope` / `delivery` to drive DomainEventBus dispatch.
// biome-ignore lint/complexity/noStaticOnlyClass: type-level marker
export abstract class DomainEvent {
  static readonly channel: string;
  static readonly scope: EventScope;
  static readonly delivery: EventDelivery = "at-most-once";
}

export type DomainEventCtor<T extends DomainEvent = DomainEvent> = {
  new (...args: never[]): T;
  readonly channel: string;
  readonly scope: EventScope;
  readonly delivery: EventDelivery;
};
