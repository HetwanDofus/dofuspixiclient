import type { Message } from "@bufbuild/protobuf";
import type { InstanceWrapper } from "@nestjs/core/injector/instance-wrapper";
import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { DiscoveryService, MetadataScanner, Reflector } from "@nestjs/core";
import {
  MESSAGE_HANDLER_METADATA,
  type MessageHandlerMeta,
} from "@shared/gateway-adapter/message-handler.decorator";

export type HandlerContext = { sessionId: string };

export type HandlerFn<M extends Message = Message> = (
  ctx: HandlerContext,
  msg: M
) => Promise<void> | void;

// typeName → [handler, ...] dispatch table, built once at boot from
// @MessageHandler-decorated methods. Multiple handlers may claim the same
// proto typeName (e.g. each GameActionRequest sub-type gets its own slice).
// Dispatch fans out; slices self-filter on the discriminator they care about.

@Injectable()
export class WsRouter implements OnModuleInit {
  private readonly logger = new Logger(WsRouter.name);
  private readonly handlers = new Map<string, HandlerFn[]>();

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector
  ) {}

  onModuleInit() {
    this.build();
  }

  build() {
    this.handlers.clear();

    for (const wrapper of this.discovery.getProviders()) {
      this.registerProvider(wrapper);
    }

    const total = Array.from(this.handlers.values()).reduce(
      (sum, list) => sum + list.length,
      0
    );

    this.logger.log(
      `registered ${total} message handler(s) across ${this.handlers.size} type(s)`
    );
  }

  private registerProvider(wrapper: InstanceWrapper) {
    const { instance } = wrapper;

    if (!instance || typeof instance !== "object") {
      return;
    }

    const proto = Object.getPrototypeOf(instance);

    if (!proto) {
      return;
    }

    for (const method of this.scanner.getAllMethodNames(proto)) {
      const fn = (instance as Record<string, unknown>)[method];

      if (typeof fn !== "function") {
        continue;
      }

      const meta = this.reflector.get<MessageHandlerMeta | undefined>(
        MESSAGE_HANDLER_METADATA,
        fn
      );

      if (!meta) {
        continue;
      }

      const bound = (fn as HandlerFn).bind(instance);
      const list = this.handlers.get(meta.typeName) ?? [];

      list.push(bound);
      this.handlers.set(meta.typeName, list);
    }
  }

  async dispatch<M extends Message>(
    ctx: HandlerContext,
    msg: M
  ): Promise<void> {
    const list = this.handlers.get(msg.$typeName);

    if (!list || list.length === 0) {
      this.logger.warn(
        `no handler for ${msg.$typeName} (session=${ctx.sessionId})`
      );
      return;
    }

    for (const handler of list) {
      try {
        await handler(ctx, msg);
      } catch (err) {
        this.logger.error(`handler ${msg.$typeName} threw`, err as Error);
      }
    }
  }
}
