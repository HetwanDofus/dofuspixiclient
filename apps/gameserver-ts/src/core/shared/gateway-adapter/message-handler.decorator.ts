// @MessageHandler(Schema) — marks a method as the handler for a client
// ClientMessage variant. The schema's typeName is the dispatch key.
// Example:
//   @MessageHandler(CastSpellRequestSchema)
//   handle(ctx, msg: CastSpellRequest) { ... }

import type { Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { applyDecorators, SetMetadata } from "@nestjs/common";

export const MESSAGE_HANDLER_METADATA = "dofus:messageHandler";

export type MessageHandlerMeta = { typeName: string };

export const MessageHandler = <M extends Message>(schema: GenMessage<M>) =>
  applyDecorators(
    SetMetadata(MESSAGE_HANDLER_METADATA, {
      typeName: schema.typeName,
    } satisfies MessageHandlerMeta)
  );
