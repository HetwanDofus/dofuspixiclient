import { describe, expect, test } from "bun:test";

import { create } from "@bufbuild/protobuf";

import { MapHandler } from "@/game/network/handlers/map.handler";
import { MessageHandler } from "@/game/network/message-handler";
import {
  ActionHarvestSchema,
  DofusMessageSchema,
  FrameObjectEntrySchema,
  GameActionSchema,
  GameFrameObject2Schema,
} from "@/game/network/protocol";

/** Cell 154 carries a tree, cell 200 carries nothing a job harvests. */
const LUMBERJACK_CELL = 154;
const LUMBERJACK_JOB = 2;

function harness(options: { harvestJob?: number } = {}) {
  const messages = new MessageHandler();
  const played: unknown[][] = [];
  const sounds: string[] = [];

  new MapHandler(
    messages,
    { send: () => {} } as never,
    { playSound: (name: string) => sounds.push(name) } as never,
    { getCurrentCharacter: () => ({ id: 1, spriteId: "1" }) } as never,
    () =>
      ({
        playHarvest: (...args: unknown[]) => played.push(args),
        setCellInteractive: () => {},
        getCellHarvestJob: (cellId: number) =>
          cellId === LUMBERJACK_CELL ? (options.harvestJob ?? 0) : 0,
      }) as never
  );

  const harvest = (cellId: number) =>
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
                cellId,
                durationMs: 12_000,
                animId: 17,
              }),
            },
          }),
        },
      })
    );

  const frame = (cellId: number, value: number) =>
    messages.handle(
      create(DofusMessageSchema, {
        payload: {
          case: "gameFrameObject2",
          value: create(GameFrameObject2Schema, {
            entries: [
              create(FrameObjectEntrySchema, {
                cellId,
                frame: value,
                interactive: false,
              }),
            ],
          }),
        },
      })
    );

  return { played, sounds, harvest, frame };
}

describe("MapHandler — harvest actions", () => {
  test("GA;501 animates every visible harvester with the tool animation", () => {
    const { played, harvest } = harness();

    harvest(LUMBERJACK_CELL);

    expect(played[0]?.slice(0, 4)).toEqual([
      42,
      LUMBERJACK_CELL,
      "anim17",
      12_000,
    ]);
  });

  test("rings the tool once per animation cycle, on the blow", () => {
    const { played, sounds, harvest } = harness({ harvestJob: LUMBERJACK_JOB });

    harvest(LUMBERJACK_CELL);
    const onCycle = played[0]?.[4] as (() => void) | undefined;

    expect(onCycle).toBeDefined();
    onCycle?.();
    onCycle?.();

    expect(sounds).toEqual(["hache_2m", "hache_2m"]);
  });

  test("a resource no job harvests animates in silence", () => {
    const { played, sounds, harvest, frame } = harness();

    harvest(LUMBERJACK_CELL);
    frame(LUMBERJACK_CELL, 3);

    expect(played[0]?.[4]).toBeUndefined();
    expect(sounds).toEqual([]);
  });

  test("the resource sounds when it gives, on the server's own frame", () => {
    const { sounds, harvest, frame } = harness({ harvestJob: LUMBERJACK_JOB });

    harvest(LUMBERJACK_CELL);
    // The reservation the server sends in the same breath as the action is
    // part of it, not its end.
    frame(LUMBERJACK_CELL, 2);
    frame(LUMBERJACK_CELL, 3);

    expect(sounds).toEqual(["cassage_bois"]);
  });

  test("an interrupted harvest returns the element without a sound", () => {
    const { sounds, harvest, frame } = harness({ harvestJob: LUMBERJACK_JOB });

    harvest(LUMBERJACK_CELL);
    frame(LUMBERJACK_CELL, 0);
    // And the completion frame that follows a *later* harvest of the same
    // cell by somebody else is no longer ours to sound.
    frame(LUMBERJACK_CELL, 3);

    expect(sounds).toEqual([]);
  });

  test("the depleted resources a map arrives with stay silent", () => {
    const { sounds, frame } = harness({ harvestJob: LUMBERJACK_JOB });

    frame(LUMBERJACK_CELL, 3);

    expect(sounds).toEqual([]);
  });
});
