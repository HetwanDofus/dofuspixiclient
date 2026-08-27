import "reflect-metadata";

import { beforeEach, describe, expect, test } from "bun:test";

import type { DofusMessage } from "@dofus/proto/server_messages_pb";
import type { FightRegistryService } from "@modules/fight/registry/fight.registry";
import type { AccessoriesService } from "@modules/inventory/accessories.service";
import type {
  PlayerAccessoryPresence,
  PlayerPresenceEntry,
} from "@modules/player-presence/player-presence.service";
import type { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";
import { SpriteMovementEntry_Operation } from "@dofus/proto/game_pb";
import { PlayerLookService } from "@modules/player-presence/player-presence.look.service";
import { PlayerPresenceService } from "@modules/player-presence/player-presence.service";

// What this covers is one thing: the moment a worn item changes, does
// every client that draws this character hear about it.

const CHARACTER = "42";
const HAT: PlayerAccessoryPresence = { itemType: 16, gfxId: 1234, ordinal: 1 };
const CAPE: PlayerAccessoryPresence = { itemType: 17, gfxId: 5678, ordinal: 2 };

let presence: PlayerPresenceService;
let accessories: PlayerAccessoryPresence[];
let inFight: boolean;
let sent: { sessions: string[]; frame: DofusMessage }[];
let service: PlayerLookService;

function entering(): PlayerPresenceEntry {
  return {
    sessionId: "s-self",
    characterId: CHARACTER,
    mapId: 7411,
    cellId: 311,
    direction: 1,
    name: "Mikos",
    level: 20,
    sex: 0,
    gfx: 10,
    color1: -1,
    color2: -1,
    color3: -1,
    accessories: [HAT],
  };
}

beforeEach(() => {
  presence = new PlayerPresenceService();
  presence.enter(entering());
  presence.enter({
    ...entering(),
    sessionId: "s-peer",
    characterId: "43",
    name: "Elyne",
  });

  accessories = [HAT];
  inFight = false;
  sent = [];

  service = new PlayerLookService(
    presence,
    {
      buildPresence: async () => accessories,
    } as unknown as AccessoriesService,
    { isInFight: () => inFight } as unknown as FightRegistryService,
    {
      broadcast: (sessions: string[], frame: DofusMessage) => {
        sent.push({ sessions, frame });
      },
    } as unknown as GatewayFrameService
  );
});

describe("PlayerLookService.refresh", () => {
  test("a new visible item reaches every client on the map, self included", async () => {
    accessories = [HAT, CAPE];

    await service.refresh(CHARACTER);

    expect(sent).toHaveLength(1);
    // Self is in the list on purpose: the local client learns what its
    // own gear looks like from this frame and nothing else.
    expect(sent[0]?.sessions.sort()).toEqual(["s-peer", "s-self"]);

    const payload = sent[0]?.frame.payload;
    if (payload?.case !== "gameMovement") {
      throw new Error("expected a gameMovement frame");
    }
    const entry = payload.value.entries[0];
    expect(entry?.operation).toBe(SpriteMovementEntry_Operation.UPDATE);
    expect(entry?.spriteId).toBe(CHARACTER);
    expect(entry?.accessories.map((a) => a.skinId)).toEqual([1234, 5678]);
  });

  test("an item with no look slot broadcasts nothing", async () => {
    // A ring is dropped by `buildPresence`, so the set is unchanged and
    // there is nothing for anyone to redraw.
    await service.refresh(CHARACTER);

    expect(sent).toHaveLength(0);
  });

  test("presence is updated but nothing is sent while in a fight", async () => {
    inFight = true;
    accessories = [HAT, CAPE];

    await service.refresh(CHARACTER);

    expect(sent).toHaveLength(0);
    // The fight's own frames drive the fighter sprite; presence still has
    // to carry the new look, since that is what the map is rebuilt from
    // when the fight ends.
    expect(presence.getByCharacter(CHARACTER)?.accessories).toEqual([
      HAT,
      CAPE,
    ]);
  });

  test("a character who is not on any map is left alone", async () => {
    accessories = [HAT, CAPE];

    await service.refresh("does-not-exist");

    expect(sent).toHaveLength(0);
  });
});
