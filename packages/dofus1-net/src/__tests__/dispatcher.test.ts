import { describe, expect, test } from "bun:test";
import { dispatch } from "../dispatcher";
// Force-register all bootstrap messages.
import "..";
import { AL } from "../messages/account/characters";
import type { Al } from "../messages/account/login";
import { Ax } from "../messages/account/servers";
import { HC } from "../messages/hello/connection";

describe("dispatch", () => {
  test("HC: 2-char opcode + raw body", () => {
    const r = dispatch("HCdeadbeef1234");
    expect(r.opcode).toBe("HC");
    expect(r.errorFlag).toBe(false);
    expect(r.body).toBe("deadbeef1234");
    expect((r.payload as HC).hashKey).toBe("deadbeef1234");
  });

  test("Al success: parses subscriber flags (success indicator char consumed)", () => {
    // Wire shape: "Al" + status char + body. AS2 substr(3) strips both.
    const r = dispatch("AlK1");
    expect(r.opcode).toBe("Al");
    expect(r.errorFlag).toBe(false);
    const al = r.payload as Al;
    expect(al.ok).toBe(true);
    expect(al.flags).toBe(1);
    expect(al.errorChar).toBe("");
    expect(al.errorLabel).toBe("");
  });

  test("Al error: error flag flips path + parses hex code + label", () => {
    const r = dispatch("AlEa");
    expect(r.opcode).toBe("Al");
    expect(r.errorFlag).toBe(true);
    expect(r.body).toBe("a");
    expect(r.payload as Al).toEqual({
      ok: false,
      errorChar: "a",
      errorLabel: "ALREADY_LOGGED",
      code: 10,
    });
  });

  test("Al error: non-hex char keeps `code=-1` but resolves the label", () => {
    // 'k' = KICKED — not a hex digit.
    const r = dispatch("AlEk");
    expect((r.payload as Al).errorChar).toBe("k");
    expect((r.payload as Al).errorLabel).toBe("KICKED");
    expect((r.payload as Al).code).toBe(-1);
  });

  test("AL: walks subscriber|count|row;row;... (success char at index 2)", () => {
    const r = dispatch(
      "ALK1|2|123;Alice;42;1;255;128;64;|456;Bob;1;5;-1;-1;-1;",
    );
    const p = r.payload as AL;
    expect(p.subscriberFlag).toBe(1);
    expect(p.count).toBe(2);
    expect(p.characters).toHaveLength(2);
    expect(p.characters[0]?.name).toBe("Alice");
    expect(p.characters[0]?.level).toBe(42);
    expect(p.characters[1]?.id).toBe("456");
  });

  test("Ax: parses aboTime + <serverId>,<count> rows (canonical 1.29 + AraknemuHorizon)", () => {
    // AxK<aboTime>|<id>,<count>|<id>,<count>
    const r = dispatch("AxK31536000000|101,2|102,0");
    const p = r.payload as Ax;
    expect(p.aboTime).toBe(31_536_000_000);
    expect(p.servers).toHaveLength(2);
    expect(p.servers[0]).toEqual({ id: 101, charactersWatched: 2 });
    expect(p.servers[1]).toEqual({ id: 102, charactersWatched: 0 });
  });

  test("GC: bodyOffset=4 (opcode + 2 extra chars consumed)", () => {
    // Wire: "GC" + status + padding + gameType
    const r = dispatch("GCKx1");
    expect(r.opcode).toBe("GC");
    expect(r.body).toBe("1");
    expect((r.payload as { gameType: number }).gameType).toBe(1);
  });

  test("unknown opcode: returns body without payload", () => {
    const r = dispatch("ZZpayload");
    expect(r.opcode).toBe("ZZ");
    expect(r.payload).toBeUndefined();
    expect(r.def).toBeUndefined();
  });

  test("empty frame: no crash", () => {
    const r = dispatch("");
    expect(r.opcode).toBe("");
    expect(r.body).toBe("");
  });
});
