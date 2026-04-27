import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { type Message, toBinary } from "@bufbuild/protobuf";
import {
  type ClientMessage,
  ClientMessageSchema,
} from "@dofus/proto/client_messages_pb";
import {
  type GatewayFrame,
  GatewayFrameSchema,
} from "@dofus/proto/gateway/v1/gateway_frame_pb";
import {
  type DofusMessage,
  DofusMessageSchema,
} from "@dofus/proto/server_messages_pb";

export type EncodedFrame = Uint8Array<ArrayBuffer>;

export function encodeFrame<M extends Message>(
  schema: GenMessage<M>,
  msg: M
): EncodedFrame {
  const body = toBinary(schema, msg);
  const buf = new ArrayBuffer(4 + body.length);
  const out = new Uint8Array(buf);

  new DataView(buf).setUint32(0, body.length, false);
  out.set(body, 4);

  return out;
}

export const encodeGatewayFrame = (msg: GatewayFrame): EncodedFrame =>
  encodeFrame(GatewayFrameSchema, msg);

export const encodeClientMessage = (msg: ClientMessage): EncodedFrame =>
  encodeFrame(ClientMessageSchema, msg);

export const encodeDofusMessage = (msg: DofusMessage): EncodedFrame =>
  encodeFrame(DofusMessageSchema, msg);

export function isOpen(socket: { readyState: number }): boolean {
  return socket.readyState > 0;
}

/**
 * Ordered write buffer for a Bun socket. Frames are appended in order and
 * flushed serially — no interleaving is possible even under backpressure.
 *
 * Usage:
 *   - Call `push(bytes)` to enqueue encoded frame bytes.
 *   - Call `flush()` from the Bun socket `drain` handler.
 */
export class WriteBuffer {
  private queue: Uint8Array[] = [];
  private offset = 0;

  push(socket: { write: (b: Uint8Array) => number }, bytes: Uint8Array): void {
    this.queue.push(bytes);

    if (this.queue.length === 1) {
      this.offset = 0;
      this.drain(socket);
    }
  }

  flush(socket: { write: (b: Uint8Array) => number }): void {
    this.drain(socket);
  }

  private drain(socket: { write: (b: Uint8Array) => number }): void {
    while (this.queue.length > 0) {
      const chunk = this.queue[0] as Uint8Array;
      const remaining = chunk.subarray(this.offset);
      const n = socket.write(remaining);

      if (n <= 0) {
        return;
      }

      this.offset += n;

      if (this.offset >= chunk.length) {
        this.queue.shift();
        this.offset = 0;
      }
    }
  }
}
