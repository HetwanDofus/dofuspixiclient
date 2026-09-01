import { describe, expect, test } from "bun:test";

import { create } from "@bufbuild/protobuf";

import { MapHandler } from "@/game/network/handlers/map.handler";
import { MessageHandler } from "@/game/network/message-handler";
import {
  ActionHarvestSchema,
  DofusMessageSchema,
  GameActionSchema,
} from "@/game/network/protocol";

describe("MapHandler — harvest actions", () => {
  test("GA;501 animates every visible harvester with the tool animation", () => {
    const messages = new MessageHandler();
    const played: unknown[][] = [];
    new MapHandler(
      messages,
      { send: () => {} } as never,
      {} as never,
      { getCurrentCharacter: () => ({ id: 1, spriteId: "1" }) } as never,
      () =>
        ({
          playHarvest: (...args: unknown[]) => played.push(args),
        }) as never
    );

    messages.handle(
      create(DofusMessageSchema, {
        payload: {
          case: "gameAction",
          value: create(GameActionSchema, {
            actionType: 501,
            spriteId: "42",
            actionData: {
              case: "harvest",
              value: create(ActionHarvestSchema, {
                cellId: 154,
                durationMs: 12_000,
                animId: 17,
              }),
            },
          }),
        },
      })
    );

    expect(played).toEqual([[42, 154, "anim17", 12_000]]);
  });
});
