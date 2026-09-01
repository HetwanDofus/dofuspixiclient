import "reflect-metadata";

import { describe, expect, test } from "bun:test";

import { create } from "@bufbuild/protobuf";
import { GameCreateRequestSchema } from "@dofus/proto/game_pb";

import { EnterGameHandler } from "./enter-game.handler";

describe("EnterGameHandler — job tool snapshot", () => {
  test("re-announces the equipped tool after the jobs snapshot", async () => {
    const calls: string[] = [];
    const handler = new EnterGameHandler(
      {
        loadPresence: async () => ({
          id: "1",
          accountId: "1",
          name: "Dev",
          level: 101,
          sex: 0,
          gfx: 10,
          mapId: 7363,
          cellId: 135,
          direction: 1,
          color1: -1,
          color2: -1,
          color3: -1,
        }),
      } as never,
      { syncSpellBook: async () => {} } as never,
      {
        findById: async () => ({
          id: 7363,
          date: "0",
          key: "",
          width: 15,
          height: 17,
          background: 0,
          musicId: 0,
          ambianceId: 0,
          cells: new Uint8Array(),
          subareaId: 0,
        }),
      } as never,
      { ensureSpawned: async () => [] } as never,
      { onMap: async () => [] } as never,
      { close: () => false } as never,
      {
        sessionsOnMap: () => [],
        onMap: () => [],
        enter: () => {},
      } as never,
      { get: () => ({ characterId: "1" }) } as never,
      { broadcast: () => {} } as never,
      { sendStats: async () => {} } as never,
      { buildSpellList: async () => [] } as never,
      { buildPresence: async () => [] } as never,
      {
        sendInventory: async () => {},
        sendTemplatesForPlayer: async () => {},
      } as never,
      {
        pushAll: async () => {
          calls.push("jobs");
        },
      } as never,
      {
        pushToolState: async () => {
          calls.push("tool");
        },
        sendAll: async () => {},
      } as never,
      {
        framesForMap: async () => {
          calls.push("frames");
        },
        sendAll: async () => {},
      } as never,
      { sendAll: async () => {} } as never
    );

    await handler.handle(
      { sessionId: "session-1" } as never,
      create(GameCreateRequestSchema, { type: 1 })
    );

    expect(calls).toEqual(["frames", "jobs", "tool"]);
  });
});
