import { create, fromBinary, toBinary } from "@bufbuild/protobuf";

import {
  ClientMessageSchema,
  DofusMessageSchema,
  type ClientMessage,
  type DofusMessage,
} from "@dofus/proto";

export type ClientPayload = ClientMessage["payload"];
export type ServerPayload = DofusMessage["payload"];
export type ClientPayloadCase = Exclude<ClientPayload["case"], undefined>;
export type ServerPayloadCase = Exclude<ServerPayload["case"], undefined>;

export type ServerPayloadValue<C extends ServerPayloadCase> = Extract<
  ServerPayload,
  { case: C }
>["value"];

export type ClientPayloadValue<C extends ClientPayloadCase> = Extract<
  ClientPayload,
  { case: C }
>["value"];

export function encodeClient<C extends ClientPayloadCase>(
  caseName: C,
  value: ClientPayloadValue<C>
): Uint8Array {
  const envelope = create(ClientMessageSchema, {
    payload: { case: caseName, value } as ClientPayload,
  });
  return toBinary(ClientMessageSchema, envelope);
}

export function decodeServer(data: ArrayBuffer | Uint8Array): DofusMessage {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  return fromBinary(DofusMessageSchema, bytes);
}

export type {
  ClientMessage,
  DofusMessage,
};

export * from "@dofus/proto";
