import "reflect-metadata";

import { beforeEach, describe, expect, mock, test } from "bun:test";

import { Injectable } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";
import {
  HandoffCoordinator,
  type Serializable,
} from "@shared/handoff/handoff.coordinator";
import { HandoffPart } from "@shared/handoff/handoff-part.decorator";

@Injectable()
@HandoffPart()
class FakeSessions implements Serializable<string[]> {
  readonly name = "sessions";
  private ids: string[] = [];

  add(id: string) {
    this.ids.push(id);
  }

  list(): string[] {
    return [...this.ids];
  }

  serialize(): string[] {
    return [...this.ids];
  }

  restore(state: string[]): void {
    this.ids = [...state];
  }
}

@Injectable()
@HandoffPart()
class FakeFights implements Serializable<Record<string, number>> {
  readonly name = "fights";
  private hp: Record<string, number> = {};

  set(id: string, hp: number) {
    this.hp[id] = hp;
  }

  get(id: string): number | undefined {
    return this.hp[id];
  }

  serialize(): Record<string, number> {
    return { ...this.hp };
  }

  restore(state: Record<string, number>): void {
    this.hp = { ...state };
  }
}

@Injectable()
class UndecoratedService {
  readonly name = "should-not-appear";
  serialize() {
    return null;
  }

  restore() {}
}

function makeFakeFrames() {
  const sentHandoff: Array<{ phase: number; snapshot?: Uint8Array }> = [];
  let handler: ((phase: number, snapshot?: Uint8Array) => void) | null = null;

  return {
    sent: sentHandoff,
    service: {
      sendHandoff: mock((phase: number, snapshot?: Uint8Array) => {
        sentHandoff.push(snapshot ? { phase, snapshot } : { phase });
      }),
      setHandoffHandler: (fn: typeof handler) => {
        handler = fn;
      },
      fire: (phase: number, snapshot?: Uint8Array) =>
        handler?.(phase, snapshot),
    },
  };
}

async function buildModule(framesStub: unknown) {
  return Test.createTestingModule({
    imports: [DiscoveryModule],
    providers: [
      HandoffCoordinator,
      FakeSessions,
      FakeFights,
      UndecoratedService,
      { provide: GatewayFrameService, useValue: framesStub },
    ],
  }).compile();
}

describe("HandoffCoordinator", () => {
  let frames: ReturnType<typeof makeFakeFrames>;

  beforeEach(() => {
    frames = makeFakeFrames();
  });

  test("discovers only providers decorated with @HandoffPart", async () => {
    const mod = await buildModule(frames.service);
    await mod.init();

    const coord = mod.get(HandoffCoordinator);
    const parts = (coord as unknown as { parts: Map<string, unknown> }).parts;

    expect([...parts.keys()].sort()).toEqual(["fights", "sessions"]);
    await mod.close();
  });

  test("snapshot → restore round-trips state across a fresh module instance", async () => {
    const mod1 = await buildModule(frames.service);
    await mod1.init();
    mod1.get(FakeSessions).add("s-1");
    mod1.get(FakeSessions).add("s-2");
    mod1.get(FakeFights).set("fight-a", 42);

    frames.service.fire(1); // DRAIN
    await new Promise((r) => setTimeout(r, 10));

    const snapshotCall = frames.sent.find((c) => c.snapshot !== undefined);
    const bytes = snapshotCall?.snapshot;
    if (!bytes) {
      throw new Error("no snapshot was sent after DRAIN");
    }

    const frames2 = makeFakeFrames();
    const mod2 = await buildModule(frames2.service);
    await mod2.init();

    frames2.service.fire(3, bytes); // RESTORE
    await new Promise((r) => setTimeout(r, 10));

    expect(mod2.get(FakeSessions).list()).toEqual(["s-1", "s-2"]);
    expect(mod2.get(FakeFights).get("fight-a")).toBe(42);

    const readyCall = frames2.sent.find(
      (c) => c.snapshot === undefined || c.snapshot.length === 0
    );
    expect(readyCall).toBeDefined();

    await mod1.close();
    await mod2.close();
  });

  test("registering duplicate part names throws", async () => {
    const mod = await buildModule(frames.service);
    await mod.init();
    const coord = mod.get(HandoffCoordinator);

    const dupe: Serializable = {
      name: "sessions",
      serialize: () => null,
      restore: () => {},
    };

    expect(() => coord.register(dupe)).toThrow("already registered");
    await mod.close();
  });
});
