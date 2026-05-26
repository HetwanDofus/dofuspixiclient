import { describe, expect, test } from "bun:test";

import { dispatch } from "../dispatcher";
import "..";
import type { AL, CharacterEntry } from "../messages/account/characters";
import type { AS } from "../messages/account/select-character";
import type { AT } from "../messages/account/send-ticket";
import type { Ax, GameServerEntry } from "../messages/account/servers";
import type { AY } from "../messages/account/select-server-compact";
import type { Al } from "../messages/account/login";
import type { AH } from "../messages/account/hosts";
import type { GC } from "../messages/game/create";
import type { GDA } from "../messages/game/adjacent-maps-data";

// End-to-end frame compatibility against AraknemuHorizon's actual
// emitters. Every wire string here is hand-built from the
// corresponding `.java` `toString()` in
// `emulators/AraknemuHorizon/src/main/java/.../network/...`.
//
// If a parser silently changes shape (e.g. wrong field count, wrong
// base for a numeric column) these tests catch it before live
// debugging.

describe("AraknemuHorizon handshake compatibility", () => {
  test("HC: realm hello with the connection key", () => {
    const r = dispatch("HCabcDEF12345");
    expect(r.opcode).toBe("HC");
    expect((r.payload as { hashKey: string }).hashKey).toBe("abcDEF12345");
  });

  test("Al: success arrives as AlK<0|1> (GMLevel emitter)", () => {
    const r = dispatch("AlK1");
    expect(r.opcode).toBe("Al");
    expect(r.errorFlag).toBe(false);
    const al = r.payload as Al;
    expect(al.ok).toBe(true);
    expect(al.flags).toBe(1);
  });

  test("Al: failure arrives as AlE<char> (LoginError emitter)", () => {
    const r = dispatch("AlEa"); // ALREADY_LOGGED
    expect(r.errorFlag).toBe(true);
    const al = r.payload as Al;
    expect(al.ok).toBe(false);
    expect(al.errorChar).toBe("a");
    expect(al.errorLabel).toBe("ALREADY_LOGGED");
    expect(al.code).toBe(10);
  });

  test("AH: host status list — id;state;completion;canLog", () => {
    // HostList.java: "AH" + id + ";" + state + ";" + completion + ";" + canLog
    const r = dispatch("AH401;1;2;1|402;0;0;0");
    const ah = r.payload as AH;
    expect(ah.hosts).toHaveLength(2);
    expect(ah.hosts[0]).toEqual({
      id: 401,
      status: 1,
      completion: 2,
      canCreate: true,
    });
    expect(ah.hosts[1]?.canCreate).toBe(false);
  });

  test("Ax: aboTime + (id,count) rows (ServerList emitter)", () => {
    // ServerList.java: "AxK" + aboTime + "|" + serverId + "," + count
    const r = dispatch("AxK0|401,2|402,1");
    const ax = r.payload as Ax;
    expect(ax.aboTime).toBe(0);
    expect(ax.servers).toHaveLength(2);
    expect(ax.servers[0]).toEqual({ id: 401, charactersWatched: 2 });
  });

  test("AY: server selection success — ip:port;ticket (SelectServerPlain)", () => {
    const r = dispatch("AYK10.0.0.1:5556;a1b2c3d4");
    const ay = r.payload as AY;
    expect(ay.ip).toBe("10.0.0.1");
    expect(ay.port).toBe(5556);
    expect(ay.ticket).toBe("a1b2c3d4");
  });

  test("HG: game-server hello — opcode only", () => {
    const r = dispatch("HG");
    expect(r.opcode).toBe("HG");
    expect((r.payload as { info: string }).info).toBe("");
  });

  test("AT: game key install — ATK<hexKeyId><key> (LoginTokenSuccess)", () => {
    // AraknemuHorizon stubs the cipher with `new LoginTokenSuccess()`,
    // which produces ATK0 (keyId=0, empty key). Our parser must
    // interpret that as "useKey(0), no install".
    const r = dispatch("ATK0");
    const at = r.payload as AT;
    expect(at.keyId).toBe(0);
    expect(at.keyHex).toBe("");
  });

  test("AT: cipher-enabled future form — ATK<hex><key>", () => {
    const r = dispatch("ATK5deadbeef");
    const at = r.payload as AT;
    expect(at.keyId).toBe(5);
    expect(at.keyHex).toBe("deadbeef");
  });

  test("AL: char list with hex-encoded colors + race ordinal", () => {
    // CharactersList.java: "ALK" + aboTime + "|" + count + per row
    //   <id>;<name>;<level>;<gfxId>;<c1hex>;<c2hex>;<c3hex>;<accessories>;<merchant>;<serverId>;<isDead>;<deadCount>
    const r = dispatch(
      "ALK0|1|42;Pippin;15;10;ff;80;40;6_123,16_456;;401;;",
    );
    const al = r.payload as AL;
    expect(al.subscriberFlag).toBe(0);
    expect(al.count).toBe(1);
    expect(al.characters).toHaveLength(1);
    const c = al.characters[0] as CharacterEntry;
    expect(c.name).toBe("Pippin");
    expect(c.level).toBe(15);
    expect(c.gfxId).toBe(10);
    expect(c.color1).toBe(0xff);
    expect(c.color2).toBe(0x80);
    expect(c.color3).toBe(0x40);
  });

  test("AS: character selected — ASK|<id>|<name>|<level>|<race>|<gender>|<gfx>|<c1>|<c2>|<c3>|<items>", () => {
    // CharacterSelected.java emits 11 pipe-separated fields after the
    // ASK header. bodyOffset=4 strips "ASK|".
    const r = dispatch("ASK|42|Pippin|15|0|0|10|ff|80|40|");
    const as = r.payload as AS;
    expect(as.id).toBe("42");
    expect(as.name).toBe("Pippin");
    expect(as.level).toBe(15);
    expect(as.guild).toBe("0"); // race ordinal in AraknemuHorizon
    expect(as.sex).toBe(0);
    expect(as.gfxId).toBe(10);
    expect(as.color1).toBe(0xff);
    expect(as.color2).toBe(0x80);
    expect(as.color3).toBe(0x40);
  });

  test("GC: game created — GCK|<type>", () => {
    const r = dispatch("GCK|1");
    const gc = r.payload as GC;
    expect(gc.gameType).toBe(1);
  });

  test("GDA: map descriptor — GDA|<cur>|<left>|<right>|<bottom>", () => {
    const r = dispatch(
      "GDA|6234;0706131721;3e5f2532357e6844|;;|6235;0706131722;aabb|;;"
    );
    const segs = (r.payload as GDA).segments();
    expect(segs.current).toEqual({
      mapId: "6234",
      dateTime: "0706131721",
      decryptKey: "3e5f2532357e6844",
    });
    expect(segs.left).toBeNull();
    expect(segs.right?.mapId).toBe("6235");
    expect(segs.bottom).toBeNull();
  });

  test("Server list join: my session merges Ax + AH by id", () => {
    // Drive both frames and confirm callers can combine them.
    const ax = dispatch("AxK0|401,2|402,0").payload as Ax;
    const ah = dispatch("AH401;1;2;1|402;0;0;0").payload as AH;
    const joined = ax.servers.map((s: GameServerEntry) => {
      const h = ah.hosts.find((x) => x.id === s.id);
      return {
        id: s.id,
        charactersWatched: s.charactersWatched,
        status: h?.status ?? 0,
        completion: h?.completion ?? 0,
        canCreate: h?.canCreate ?? false,
      };
    });
    expect(joined).toEqual([
      {
        id: 401,
        charactersWatched: 2,
        status: 1,
        completion: 2,
        canCreate: true,
      },
      {
        id: 402,
        charactersWatched: 0,
        status: 0,
        completion: 0,
        canCreate: false,
      },
    ]);
  });
});
