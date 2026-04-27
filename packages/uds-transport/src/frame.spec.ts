import { describe, expect, test } from "bun:test";

import { create } from "@bufbuild/protobuf";
import {
  AccountSelectServerRequestSchema,
  AccountSendTicketSchema,
} from "@dofus/proto/account_pb";
import { ClientMessageSchema } from "@dofus/proto/client_messages_pb";

import { encodeClientMessage, encodeFrame } from "./codec.ts";
import { FrameReader } from "./frame-reader.ts";

function ticket(raw: string) {
  return create(ClientMessageSchema, {
    payload: {
      case: "accountSendTicket",
      value: create(AccountSendTicketSchema, { ticket: raw }),
    },
  });
}

describe("FrameReader", () => {
  test("decodes a whole frame pushed in one chunk", () => {
    const r = new FrameReader(ClientMessageSchema);
    const out = r.push(encodeClientMessage(ticket("t-42")));

    expect(out).toHaveLength(1);
    expect(out[0]?.payload.case).toBe("accountSendTicket");
    expect(out[0]?.payload.value).toMatchObject({ ticket: "t-42" });
  });

  test("decodes multiple frames from a single chunk", () => {
    const r = new FrameReader(ClientMessageSchema);
    const a = encodeClientMessage(ticket("a"));
    const b = encodeClientMessage(ticket("b"));
    const c = encodeClientMessage(ticket("c"));

    const merged = new Uint8Array(a.length + b.length + c.length);
    merged.set(a, 0);
    merged.set(b, a.length);
    merged.set(c, a.length + b.length);

    const out = r.push(merged);
    expect(
      out.map((m) => (m.payload.value as { ticket: string }).ticket)
    ).toEqual(["a", "b", "c"]);
  });

  test("handles frames split across chunks", () => {
    const r = new FrameReader(ClientMessageSchema);
    const encoded = encodeClientMessage(ticket("split"));

    for (let i = 0; i < encoded.length - 1; i += 1) {
      expect(r.push(encoded.subarray(i, i + 1))).toHaveLength(0);
    }
    const out = r.push(encoded.subarray(encoded.length - 1));

    expect(out).toHaveLength(1);
    expect(out[0]?.payload.case).toBe("accountSendTicket");
  });

  test("buffers a partial length prefix across pushes", () => {
    const r = new FrameReader(ClientMessageSchema);
    const encoded = encodeClientMessage(ticket("partial"));

    expect(r.push(encoded.subarray(0, 2))).toHaveLength(0);
    expect(r.push(encoded.subarray(2, 4))).toHaveLength(0);
    const out = r.push(encoded.subarray(4));

    expect(out).toHaveLength(1);
  });

  test("round-trips a non-ticket variant", () => {
    const r = new FrameReader(ClientMessageSchema);
    const msg = create(ClientMessageSchema, {
      payload: {
        case: "accountSelectServer",
        value: create(AccountSelectServerRequestSchema, { serverId: 42 }),
      },
    });

    const out = r.push(encodeFrame(ClientMessageSchema, msg));
    expect(out[0]?.payload.case).toBe("accountSelectServer");
    expect(out[0]?.payload.value).toMatchObject({ serverId: 42 });
  });
});
