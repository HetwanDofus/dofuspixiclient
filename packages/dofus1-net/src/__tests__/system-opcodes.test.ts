import { describe, expect, test } from "bun:test";
import { dispatch } from "../dispatcher";
import "..";
import type { ServerMessage } from "../messages/system/server-message";

describe("1-char opcodes — system layer", () => {
  test("p (Pong) — matches 1-char and produces empty payload", () => {
    const r = dispatch("p");
    expect(r.opcode).toBe("p");
    expect(r.payload).toEqual({});
  });

  test("q (QuickPong)", () => {
    const r = dispatch("q");
    expect(r.opcode).toBe("q");
    expect(r.payload).toEqual({});
  });

  test("k (Server Will Disconnect)", () => {
    const r = dispatch("k");
    expect(r.opcode).toBe("k");
    expect(r.payload).toEqual({});
  });

  test("M (ServerMessage) — pre-login flavor (no '|' between flavor and id)", () => {
    // Wire: "M" + flavor "0" + id "12" + "|" + params
    const r = dispatch("M012|spell;42;extra");
    expect(r.opcode).toBe("M");
    const p = r.payload as ServerMessage;
    expect(p).toEqual({
      kind: "preLogin",
      id: 12,
      params: ["spell", "42", "extra"],
    });
  });

  test("M (ServerMessage) — interactive flavor with callback", () => {
    // Wire: "M" + flavor "1" + id "23" + "|" + params + "|" + cb
    const r = dispatch("M123|playerName;count|onAccept");
    const p = r.payload as ServerMessage;
    expect(p).toEqual({
      kind: "interactive",
      id: 23,
      params: ["playerName", "count"],
      callbackName: "onAccept",
    });
  });

  test("r (RandomPing) — captures echo token", () => {
    // Wire: "r" + 4 prefix chars + token
    const r = dispatch("rXXXXmytoken");
    expect(r.opcode).toBe("r");
    expect((r.payload as { token: string }).token).toBe("mytoken");
  });

  test("BN (Basics Null) — no-op opcode", () => {
    const r = dispatch("BN");
    expect(r.opcode).toBe("BN");
    expect(r.payload).toEqual({});
  });
});
