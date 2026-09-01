import "reflect-metadata";

import { describe, expect, test } from "bun:test";

import { create } from "@bufbuild/protobuf";
import { GameActionRequestSchema, GameActionType } from "@dofus/proto/game_pb";

import { MoveHandler } from "./move.handler";

describe("MoveHandler — active harvest", () => {
  test("refuses every movement until the harvest deadline", async () => {
    let loadedMap = false;
    const handler = new MoveHandler(
      {
        load: async () => {
          loadedMap = true;
        },
      } as never,
      { getByCharacter: () => ({ mapId: 7363, cellId: 153 }) } as never,
      {} as never,
      { blocksMovement: () => false } as never,
      { isRunning: () => true } as never,
      { get: () => ({ characterId: "char-1" }) } as never,
      {} as never
    );

    await handler.handle(
      { sessionId: "session-1" } as never,
      create(GameActionRequestSchema, {
        actionType: GameActionType.ACTION_MOVEMENT,
        params: "ignored-because-locked",
      })
    );

    expect(loadedMap).toBe(false);
  });
});
