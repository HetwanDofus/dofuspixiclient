// Ax — Account Servers List (Account.as:onServersList).
//
// Canonical wire (verified against AraknemuHorizon's `ServerList.java`
// AND `dofus/aks/Account.as:430` parser):
//
//   `Ax<headChar><aboTime>|<id>,<count>|<id>,<count>|...`
//
// - `headChar` is a single status byte (e.g. `K` for ok). The
//   dispatcher's bodyOffset=3 strips opcode + that byte.
// - `aboTime` is the player's subscription remaining time in ms;
//   `> 0` means the account is subscribed. We store it but the AS2
//   client only looks at the sign.
// - Each subsequent `|`-separated row is `<serverId>,<charactersCount>` —
//   comma-separated, two fields. The server status, completion bar
//   etc. are pushed separately via `AH` (HostList).

import { Composite, F, WireIn } from "../../wire";

@Composite({ separator: "," })
export class GameServerEntry {
  @F.int(0) id: number;
  /** Number of characters this account has on the server. */
  @F.int(1) charactersWatched: number;
}

@WireIn({
  opcode: "Ax",
  bodyOffset: 3,
  parse(body) {
    const inst = new Ax();
    if (body === "") {
      return inst;
    }
    const cells = body.split("|");
    const head = cells[0] ?? "";
    const ms = Number.parseInt(head, 10);
    inst.aboTime = Number.isNaN(ms) ? 0 : ms;
    inst.servers = cells.slice(1).map((row) => {
      const [idRaw = "", countRaw = ""] = row.split(",");
      const id = Number.parseInt(idRaw, 10);
      const count = Number.parseInt(countRaw, 10);
      const e = new GameServerEntry();
      e.id = Number.isNaN(id) ? 0 : id;
      e.charactersWatched = Number.isNaN(count) ? 0 : count;
      return e;
    });
    return inst;
  },
})
export class Ax {
  /** Subscription remaining in ms. `> 0` → subscriber. */
  aboTime: number;
  servers: GameServerEntry[] = [];
}
