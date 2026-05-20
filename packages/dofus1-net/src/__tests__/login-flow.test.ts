import { describe, expect, test } from "bun:test";
import { dispatch } from "../dispatcher";
import { buildOutboundFrame } from "../wire";
import "..";
import { AK } from "../messages/account/network-key";
import { AkOut } from "../messages/account/key-ack";
import { AVOut } from "../messages/account/regional-version";
import { AfOut } from "../messages/account/new-queue";
import { AX, AXOut } from "../messages/account/select-server";
import { AS, ASOut } from "../messages/account/select-character";
import { AT, ATOut } from "../messages/account/send-ticket";
import { AH } from "../messages/account/hosts";
import { buildLoginFrame, cryptPassword } from "../messages/account/login-credentials";

describe("login credentials helper", () => {
  test("cryptPassword: canonical Vigenere base64 output, '#1' prefix", () => {
    const out = cryptPassword("password", "abcdefghijklmnop");
    expect(out.startsWith("#1")).toBe(true);
    expect(out.length).toBe(2 + "password".length * 2);
    const alpha =
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";
    for (const ch of out.slice(2)) {
      expect(alpha.includes(ch)).toBe(true);
    }
  });

  test("cryptPassword: known-good vector ('a' under key 'K')", () => {
    // Hand-computed against the canonical algorithm:
    //   pwd[0]='a' (97) → hi=6, lo=1
    //   key[0]='K' (75) → k%64 = 11
    //   HASH[(6+11)%64]=HASH[17]='r', HASH[(1+11)%64]=HASH[12]='m'
    expect(cryptPassword("a", "K")).toBe("#1rm");
  });

  test("buildLoginFrame: clear mode passes the password through", () => {
    expect(buildLoginFrame({ login: "user", password: "pw" })).toBe(
      "user\npw",
    );
  });

  test("buildLoginFrame: encrypted mode emits '#1' + base64 cypher", () => {
    const frame = buildLoginFrame({
      login: "user",
      password: "pw",
      connexionKey: "abcdefgh",
    });
    expect(frame.startsWith("user\n#1")).toBe(true);
    expect(frame.slice("user\n#1".length).length).toBe("pw".length * 2);
  });
});

describe("Account opcodes — login vertical", () => {
  test("AK installs a key (keyId hex + keyHex)", () => {
    const r = dispatch("AK3ABCDEF1234");
    expect(r.opcode).toBe("AK");
    const p = r.payload as AK;
    expect(p.keyId).toBe(3);
    expect(p.keyHex).toBe("ABCDEF1234");
  });

  test("AT inbound: TicketResponse with key install (keyId > 0)", () => {
    const r = dispatch("ATx5ABCDEF");
    expect(r.opcode).toBe("AT");
    const p = r.payload as AT;
    expect(p.keyId).toBe(5);
    expect(p.keyHex).toBe("ABCDEF");
  });

  test("AT inbound: keyId 0 → no install, just useKey(0)", () => {
    const p = dispatch("ATx0").payload as AT;
    expect(p.keyId).toBe(0);
    expect(p.keyHex).toBe("");
  });

  test("AT outbound: ticket frame is opcode + ticket", () => {
    const req = new ATOut();
    req.ticket = "abc123";
    expect(buildOutboundFrame(req)).toBe("ATabc123");
  });

  test("AH parses thin host list", () => {
    const r = dispatch("AH101;1;3;1|102;0;0;0|103;2;1;1");
    expect(r.opcode).toBe("AH");
    const p = r.payload as AH;
    expect(p.hosts).toHaveLength(3);
    expect(p.hosts[0]).toEqual({
      id: 101,
      status: 1,
      completion: 3,
      canCreate: true,
    });
  });

  test("AV inbound: single int; outbound: empty body", () => {
    const p = dispatch("AV10").payload as { version: number };
    expect(p.version).toBe(10);
    expect(buildOutboundFrame(new AVOut())).toBe("AV");
  });

  test("AR parses base-36 restrictions mask", () => {
    const p = dispatch("ARz").payload as { restrictions: number };
    expect(p.restrictions).toBe(35);
  });

  test("Aq parses queue position", () => {
    const p = dispatch("Aq42").payload as { position: number };
    expect(p.position).toBe(42);
  });

  test("Af inbound: queue snapshot", () => {
    const r = dispatch("Af5|100|200|1|7");
    expect(r.payload).toEqual({
      position: 5,
      totalSubscriber: 100,
      totalNonSubscriber: 200,
      isSubscriber: true,
      queueId: 7,
    });
  });

  test("Af outbound: empty body request", () => {
    expect(buildOutboundFrame(new AfOut())).toBe("Af");
  });

  test("AX inbound: decodes packed IP + base64 port + ticket", () => {
    // bodyOffset=3, wire = "AX" + 1 status char + ipHex8 + portB64-3 + ticket
    // IP 64.32.16.8 → "40201008"; port 5555 → "BWz".
    const r = dispatch("AXx40201008BWzmyticket");
    expect(r.opcode).toBe("AX");
    const p = r.payload as AX;
    expect(p.ip).toBe("64.32.16.8");
    expect(p.port).toBe(5555);
    expect(p.ticket).toBe("myticket");
  });

  test("AX outbound: serialize is just the server id", () => {
    const req = new AXOut();
    req.serverId = 42;
    expect(buildOutboundFrame(req)).toBe("AX42");
  });

  test("AS inbound: character data after pick (bodyOffset=4)", () => {
    const r = dispatch("ASxx101|Alice|50|Guild|0|1|255|128|64|itemBlob");
    expect(r.opcode).toBe("AS");
    const p = r.payload as AS;
    expect(p.name).toBe("Alice");
    expect(p.level).toBe(50);
    expect(p.gfxId).toBe(1);
  });

  test("AS outbound: just the character id", () => {
    const req = new ASOut();
    req.characterId = "777";
    expect(buildOutboundFrame(req)).toBe("AS777");
  });

  test("AkOut: HEX char of key slot", () => {
    const ack = new AkOut();
    ack.keyId = 3;
    expect(buildOutboundFrame(ack)).toBe("Ak3");
    ack.keyId = 12;
    expect(buildOutboundFrame(ack)).toBe("AkC");
    ack.keyId = 15;
    expect(buildOutboundFrame(ack)).toBe("AkF");
  });

  test("AK + Crypto: install keyId from a parsed AK", () => {
    const hexKey = "61626364656667686970717273747576";
    const ak = dispatch(`AK4${hexKey}`).payload as AK;
    expect(ak.keyId).toBe(4);
    expect(ak.keyHex).toBe(hexKey);
  });
});
