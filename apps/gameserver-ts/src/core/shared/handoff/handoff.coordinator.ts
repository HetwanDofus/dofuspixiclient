// Coordinates blue/green handoff on the core side. Uses proto HandoffControl
// enum for phase values.

import { HandoffControl_Phase } from "@dofus/proto/gateway/v1/gateway_frame_pb";
import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { DiscoveryService, Reflector } from "@nestjs/core";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";
import { HANDOFF_PART_METADATA } from "@shared/handoff/handoff-part.decorator";

export interface Serializable<S = unknown> {
  readonly name: string;
  serialize(): S;
  restore(state: S): void;
  onDrain?(): Promise<void> | void;
  onResume?(): Promise<void> | void;
}

type SnapshotEnvelope = {
  version: 1;
  parts: Record<string, unknown>;
};

@Injectable()
export class HandoffCoordinator implements OnModuleInit {
  private readonly logger = new Logger(HandoffCoordinator.name);
  private readonly parts = new Map<string, Serializable>();

  constructor(
    private readonly frames: GatewayFrameService,
    private readonly discovery: DiscoveryService,
    private readonly reflector: Reflector
  ) {}

  onModuleInit() {
    this.frames.setHandoffHandler((phase, snapshot) =>
      this.onHandoffFrame(phase, snapshot)
    );
    this.discoverParts();
  }

  // Auto-discovers every provider decorated with @HandoffPart() that
  // implements Serializable. Feature modules never import this class —
  // keeps the handoff concern decoupled from domain code.
  private discoverParts() {
    for (const wrapper of this.discovery.getProviders()) {
      const { instance } = wrapper;
      if (!instance || typeof instance !== "object") {
        continue;
      }
      const ctor = (instance as { constructor?: unknown }).constructor;
      if (typeof ctor !== "function") {
        continue;
      }
      const marked = this.reflector.get<boolean | undefined>(
        HANDOFF_PART_METADATA,
        ctor
      );
      if (!marked) {
        continue;
      }
      if (!isSerializable(instance)) {
        this.logger.warn(
          `${(ctor as { name: string }).name} has @HandoffPart() but does not implement Serializable — skipping`
        );
        continue;
      }
      this.register(instance);
    }
    this.logger.log(
      `discovered ${this.parts.size} handoff parts: ${[...this.parts.keys()].join(", ")}`
    );
  }

  register(part: Serializable) {
    if (this.parts.has(part.name)) {
      throw new Error(`handoff part "${part.name}" already registered`);
    }
    this.parts.set(part.name, part);
  }

  async onHandoffFrame(
    phase: HandoffControl_Phase,
    snapshot?: Uint8Array
  ): Promise<void> {
    switch (phase) {
      case HandoffControl_Phase.DRAIN:
        return this.drainAndSnapshot();
      case HandoffControl_Phase.RESTORE:
        if (!snapshot) {
          throw new Error("restore frame missing snapshot");
        }
        return this.restoreAndResume(snapshot);
      case HandoffControl_Phase.SHUTDOWN:
        this.logger.log("shutdown requested by gateway");
        // Trigger Nest's enabled shutdown hooks (onModuleDestroy, etc.)
        // instead of a hard process.exit.
        setTimeout(() => process.kill(process.pid, "SIGTERM"), 100);
        return;
      default:
        return;
    }
  }

  private async drainAndSnapshot(): Promise<void> {
    this.logger.log("drain: quiescing parts");
    for (const part of this.parts.values()) {
      await part.onDrain?.();
    }

    const envelope: SnapshotEnvelope = { version: 1, parts: {} };
    for (const [name, part] of this.parts) {
      envelope.parts[name] = part.serialize();
    }
    const bytes = new TextEncoder().encode(JSON.stringify(envelope));
    this.logger.log(
      `snapshot ready (${bytes.byteLength} bytes, ${this.parts.size} parts)`
    );
    this.frames.sendHandoff(HandoffControl_Phase.SNAPSHOT, bytes);
  }

  private async restoreAndResume(bytes: Uint8Array): Promise<void> {
    const envelope = JSON.parse(
      new TextDecoder().decode(bytes)
    ) as SnapshotEnvelope;
    if (envelope.version !== 1) {
      throw new Error(`unknown snapshot version ${envelope.version}`);
    }

    this.logger.log(`restoring ${Object.keys(envelope.parts).length} parts`);
    for (const [name, state] of Object.entries(envelope.parts)) {
      const part = this.parts.get(name);
      if (!part) {
        this.logger.warn(
          `snapshot has part "${name}" not registered in this version — skipping`
        );
        continue;
      }
      part.restore(state);
    }
    for (const part of this.parts.values()) {
      await part.onResume?.();
    }

    this.logger.log("restore complete — signalling READY");
    this.frames.sendHandoff(HandoffControl_Phase.READY);
  }
}

function isSerializable(x: unknown): x is Serializable {
  const o = x as Partial<Serializable>;
  return (
    typeof o.name === "string" &&
    typeof o.serialize === "function" &&
    typeof o.restore === "function"
  );
}
