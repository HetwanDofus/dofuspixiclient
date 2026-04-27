import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { SchedulerService } from "@modules/scheduler/scheduler.service";
import { EventEmitter2 } from "@nestjs/event-emitter";

describe("SchedulerService", () => {
  let events: EventEmitter2;
  let scheduler: SchedulerService;

  beforeEach(() => {
    events = new EventEmitter2();
    scheduler = new SchedulerService(events);
  });

  afterEach(() => {
    scheduler.onModuleDestroy();
  });

  test("fires the channel with payload after the delay", async () => {
    const seen: unknown[] = [];
    events.on("test.fire", (p: unknown) => {
      seen.push(p);
    });

    scheduler.schedule({
      id: "j1",
      dueAt: Date.now() + 20,
      channel: "test.fire",
      payload: { n: 42 },
    });

    await new Promise((r) => setTimeout(r, 40));

    expect(seen).toEqual([{ n: 42 }]);
  });

  test("cancel stops a pending job", async () => {
    const seen: unknown[] = [];
    events.on("test.cancel", (p: unknown) => {
      seen.push(p);
    });

    scheduler.schedule({
      id: "j1",
      dueAt: Date.now() + 30,
      channel: "test.cancel",
      payload: null,
    });

    expect(scheduler.cancel("j1")).toBe(true);
    await new Promise((r) => setTimeout(r, 50));

    expect(seen).toHaveLength(0);
  });

  test("rescheduling the same id replaces the prior timer", async () => {
    const seen: unknown[] = [];
    events.on("test.replace", (p: unknown) => {
      seen.push(p);
    });

    scheduler.schedule({
      id: "j1",
      dueAt: Date.now() + 10,
      channel: "test.replace",
      payload: "a",
    });
    scheduler.schedule({
      id: "j1",
      dueAt: Date.now() + 30,
      channel: "test.replace",
      payload: "b",
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(seen).toEqual(["b"]);
  });

  test("serialize + restore re-arms remaining timers", async () => {
    const seen: unknown[] = [];
    events.on("test.restore", (p: unknown) => {
      seen.push(p);
    });

    scheduler.schedule({
      id: "j1",
      dueAt: Date.now() + 30,
      channel: "test.restore",
      payload: "ok",
    });

    const snapshot = scheduler.serialize();
    scheduler.onModuleDestroy();

    const restored = new SchedulerService(events);
    restored.restore(snapshot);

    await new Promise((r) => setTimeout(r, 50));

    expect(seen).toEqual(["ok"]);
    restored.onModuleDestroy();
  });

  test("restore fires overdue jobs immediately", async () => {
    const seen: unknown[] = [];
    events.on("test.overdue", (p: unknown) => {
      seen.push(p);
    });

    scheduler.restore([
      {
        id: "late",
        dueAt: Date.now() - 10_000,
        channel: "test.overdue",
        payload: 1,
      },
    ]);

    await new Promise((r) => setTimeout(r, 10));

    expect(seen).toEqual([1]);
  });
});
