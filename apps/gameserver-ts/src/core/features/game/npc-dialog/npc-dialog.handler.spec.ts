import "reflect-metadata";

import { beforeEach, describe, expect, test } from "bun:test";

import type { DofusMessage } from "@dofus/proto/server_messages_pb";
import type { FightRegistryService } from "@modules/fight/registry/fight.registry";
import type { LiveNpc, MapNpcService } from "@modules/npcs/map-npc.service";
import type { NpcDialogService } from "@modules/npcs/npc-dialog.service";
import type { PlayerPresenceService } from "@modules/player-presence/player-presence.service";
import type { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";
import type { HandlerContext } from "@shared/gateway-adapter/ws-router";
import { create } from "@bufbuild/protobuf";
import {
  DialogCreateRequestSchema,
  DialogResponseRequestSchema,
} from "@dofus/proto/chat_pb";
import { NpcDialogHandler } from "@features/game/npc-dialog/npc-dialog.handler";
import { ExchangeService } from "@modules/exchange/exchange.service";
import { OwnerKind } from "@modules/items/item-owner";
import { JobsService } from "@modules/jobs/jobs.service";
import { NpcDialogSessionService } from "@modules/npcs/npc-dialog.session";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { SessionRegistry } from "@shared/gateway-adapter/session-registry";

// Kana Petch on map 7365: the reference tree. Question 2391 offers two
// branches (2013 -> 2394, 2011 -> 1169) and one answer that hands over an
// item, which this server cannot do and therefore must not follow.
const SESSION = "s-1";
const MAP_ID = 7365;
const NPC_SPRITE_ID = -100_000_594;
const ACCOUNT = "acc-1";

/**
 * The banker: question 318 offers answer 259, the one carrying the dump's
 * lone `type = -1`, named "Consulter son coffre personnel".
 */
const BANK_QUESTION = 318;
const BANK_RESPONSE = 259;

/**
 * A job master. `(280, 6, '2,898,335,1489')` is the dump's own
 * "Apprendre le métier de Bûcheron": job 2, question 335 once granted,
 * question 1489 when the slot rules refuse.
 */
const JOB_QUESTION = 897;
const JOB_RESPONSE = 280;
const JOB_ON_SUCCESS = 335;
const JOB_ON_FAILURE = 1489;

const NPC = {
  id: NPC_SPRITE_ID,
  templateId: 594,
  mapId: MAP_ID,
  cellId: 79,
  direction: 1,
  name: "Kana Petch",
  gfx: 9008,
  sex: 0,
  color1: -1,
  color2: -1,
  color3: -1,
  scaleX: 100,
  scaleY: 100,
  accessories: [],
  customArtwork: 0,
  initialQuestion: 2391,
  path: "",
  isMovable: false,
} satisfies LiveNpc;

const QUESTIONS: Record<number, number[]> = {
  2391: [2013, 2011, 2037],
  2394: [],
  // The banker's own question, kept apart from Kana Petch's tree so the
  // reference assertions above stay about the reference tree.
  [BANK_QUESTION]: [BANK_RESPONSE, 329],
  [JOB_QUESTION]: [JOB_RESPONSE],
  [JOB_ON_SUCCESS]: [],
  [JOB_ON_FAILURE]: [],
};

let sent: DofusMessage[];
let open: NpcDialogSessionService;
let handler: NpcDialogHandler;
let inFight: boolean;
let banksOpened: { accountId: string; ownerKind: number; kind: number }[];
let jobsLearned: { characterId: string; jobId: number }[];
let learnSucceeds: boolean;

const ctx = { sessionId: SESSION } as HandlerContext;

beforeEach(() => {
  sent = [];
  inFight = false;
  banksOpened = [];
  jobsLearned = [];
  learnSucceeds = true;
  open = new NpcDialogSessionService();

  const registry = new SessionRegistry(new EventEmitter2());
  registry.open({
    sessionId: SESSION,
    accountId: ACCOUNT,
    characterId: "char-1",
    remoteAddr: "10.0.0.1",
  });
  registry.attachCharacter(SESSION, "char-1");

  const presence = {
    getByCharacter: () => ({ mapId: MAP_ID }),
  } as unknown as PlayerPresenceService;

  const npcs = {
    onMapById: (mapId: number, spriteId: number) =>
      mapId === MAP_ID && spriteId === NPC_SPRITE_ID ? NPC : undefined,
  } as unknown as MapNpcService;

  const graph = {
    question: async (id: number) =>
      QUESTIONS[id]
        ? { id, responseIds: QUESTIONS[id], parameters: [] }
        : undefined,
    outcome: async (responseId: number) => {
      if (responseId === 2013) {
        return { kind: "branch" as const, nextQuestion: 2394 };
      }
      if (responseId === 2037) {
        return { kind: "blocked" as const };
      }
      if (responseId === BANK_RESPONSE) {
        return { kind: "open-bank" as const };
      }
      if (responseId === JOB_RESPONSE) {
        return {
          kind: "learn-job" as const,
          jobId: 2,
          onSuccess: JOB_ON_SUCCESS,
          onFailure: JOB_ON_FAILURE,
        };
      }
      return { kind: "end" as const };
    },
    unavailable: async (ids: readonly number[]) =>
      ids.filter((id) => id === 2037),
  } as unknown as NpcDialogService;

  const fights = {
    isInFight: () => inFight,
  } as unknown as FightRegistryService;

  const frames = {
    broadcast: (_targets: string[], msg: DofusMessage) => sent.push(msg),
  } as unknown as GatewayFrameService;

  const exchange = {
    openStorage: async (
      _sessionId: string,
      accountId: string,
      _characterId: string,
      owner: { kind: number; id: string },
      kind: number
    ) => {
      banksOpened.push({ accountId, ownerKind: owner.kind, kind });
      return { ok: true as const };
    },
  } as unknown as ExchangeService;

  const jobs = {
    learn: async (_sessionId: string, characterId: string, jobId: number) => {
      jobsLearned.push({ characterId, jobId });
      return learnSucceeds
        ? { ok: true as const, jobId }
        : { ok: false as const, reason: "no-slot-left" as const };
    },
  } as unknown as JobsService;

  handler = new NpcDialogHandler(
    registry,
    presence,
    npcs,
    fights,
    graph,
    open,
    exchange,
    jobs,
    frames
  );
});

function cases(): string[] {
  return sent.map((m) => m.payload.case ?? "");
}

async function openDialog(): Promise<void> {
  await handler.create(
    ctx,
    create(DialogCreateRequestSchema, { npcSpriteId: BigInt(NPC_SPRITE_ID) })
  );
  sent = [];
}

describe("DC", () => {
  test("opens with the portrait, then the first question", async () => {
    await handler.create(
      ctx,
      create(DialogCreateRequestSchema, { npcSpriteId: BigInt(NPC_SPRITE_ID) })
    );

    expect(cases()).toEqual(["dialogCreate", "dialogQuestion"]);

    const created = sent[0]?.payload;
    if (created?.case !== "dialogCreate") {
      throw new Error("expected dialogCreate");
    }
    expect(created.value.success).toBe(true);
    expect(created.value.gfxId).toBe(9008);
    expect(created.value.name).toBe("Kana Petch");

    const question = sent[1]?.payload;
    if (question?.case !== "dialogQuestion") {
      throw new Error("expected dialogQuestion");
    }
    expect(question.value.questionId).toBe(2391);
    expect(question.value.responseIds).toEqual([2013, 2011, 2037]);
    // The answer that hands over an item is listed, greyed.
    expect(question.value.unavailableResponseIds).toEqual([2037]);
  });

  test("refuses a sprite that is not an NPC on the player's map", async () => {
    await handler.create(
      ctx,
      create(DialogCreateRequestSchema, { npcSpriteId: BigInt(-1) })
    );

    const created = sent[0]?.payload;
    if (created?.case !== "dialogCreate") {
      throw new Error("expected dialogCreate");
    }
    expect(created.value.success).toBe(false);
    expect(open.get(SESSION)).toBeUndefined();
  });

  test("refuses while the player is in a fight", async () => {
    inFight = true;
    await handler.create(
      ctx,
      create(DialogCreateRequestSchema, { npcSpriteId: BigInt(NPC_SPRITE_ID) })
    );

    expect(sent).toHaveLength(0);
    expect(open.get(SESSION)).toBeUndefined();
  });
});

describe("DR", () => {
  test("follows a branch and sends the next question", async () => {
    await openDialog();

    await handler.respond(
      ctx,
      create(DialogResponseRequestSchema, {
        questionId: 2391,
        responseId: 2013,
      })
    );

    expect(cases()).toEqual(["dialogQuestion"]);
    expect(open.get(SESSION)?.questionId).toBe(2394);
  });

  test("the banker's answer opens the account bank and closes the talk", async () => {
    // Opened straight onto the banker's question rather than walked to:
    // `NpcDialogSessionService` is the real thing here, so seeding it is
    // the same state the DC path would have produced.
    open.open(SESSION, {
      npcSpriteId: NPC_SPRITE_ID,
      templateId: 1,
      mapId: MAP_ID,
      questionId: BANK_QUESTION,
    });

    await handler.respond(
      ctx,
      create(DialogResponseRequestSchema, {
        questionId: BANK_QUESTION,
        responseId: BANK_RESPONSE,
      })
    );

    // The conversation goes away first: canonical `onLeave` unloads every
    // exchange window it can find, so a `DV` sent after `EC` would tear
    // down the bank the instant it opened.
    expect(cases()).toEqual(["dialogLeave"]);
    expect(open.get(SESSION)).toBeUndefined();
    expect(banksOpened).toEqual([
      { accountId: ACCOUNT, ownerKind: OwnerKind.Bank, kind: 5 },
    ]);
  });

  test("teaches the job, then branches to the master's thanks", async () => {
    open.open(SESSION, {
      npcSpriteId: NPC_SPRITE_ID,
      templateId: NPC.templateId,
      mapId: MAP_ID,
      questionId: JOB_QUESTION,
    });

    await handler.respond(
      ctx,
      create(DialogResponseRequestSchema, {
        questionId: JOB_QUESTION,
        responseId: JOB_RESPONSE,
      })
    );

    expect(jobsLearned).toEqual([{ characterId: "char-1", jobId: 2 }]);
    expect(cases()).toEqual(["dialogQuestion"]);
    expect(open.get(SESSION)?.questionId).toBe(JOB_ON_SUCCESS);
  });

  test("a refusal branches too — three jobs already is an answer, not an error", async () => {
    learnSucceeds = false;
    open.open(SESSION, {
      npcSpriteId: NPC_SPRITE_ID,
      templateId: NPC.templateId,
      mapId: MAP_ID,
      questionId: JOB_QUESTION,
    });

    await handler.respond(
      ctx,
      create(DialogResponseRequestSchema, {
        questionId: JOB_QUESTION,
        responseId: JOB_RESPONSE,
      })
    );

    // The dialog must stay open on the "you cannot" line rather than
    // vanishing, which would read as the game having ignored the click.
    expect(cases()).toEqual(["dialogQuestion"]);
    expect(open.get(SESSION)?.questionId).toBe(JOB_ON_FAILURE);
  });

  test("closes on an answer whose action is DV", async () => {
    await openDialog();

    await handler.respond(
      ctx,
      create(DialogResponseRequestSchema, {
        questionId: 2391,
        responseId: 2011,
      })
    );

    expect(cases()).toEqual(["dialogLeave"]);
    expect(open.get(SESSION)).toBeUndefined();
  });

  test("ignores an answer for a question the player is not on", async () => {
    await openDialog();

    await handler.respond(
      ctx,
      create(DialogResponseRequestSchema, {
        questionId: 2394,
        responseId: 2013,
      })
    );

    expect(sent).toHaveLength(0);
    expect(open.get(SESSION)?.questionId).toBe(2391);
  });

  test("ignores an answer that belongs to another question", async () => {
    await openDialog();

    await handler.respond(
      ctx,
      create(DialogResponseRequestSchema, { questionId: 2391, responseId: 999 })
    );

    expect(sent).toHaveLength(0);
    expect(open.get(SESSION)?.questionId).toBe(2391);
  });

  test("ignores a blocked answer without closing the dialog", async () => {
    await openDialog();

    await handler.respond(
      ctx,
      create(DialogResponseRequestSchema, {
        questionId: 2391,
        responseId: 2037,
      })
    );

    // Closing here would read as "the item was handed over and we are done".
    expect(sent).toHaveLength(0);
    expect(open.get(SESSION)?.questionId).toBe(2391);
  });

  test("does nothing at all when no dialog is open", async () => {
    await handler.respond(
      ctx,
      create(DialogResponseRequestSchema, {
        questionId: 2391,
        responseId: 2013,
      })
    );

    expect(sent).toHaveLength(0);
  });
});

describe("session state", () => {
  test("an open dialog pins its NPC so the wander tick skips it", async () => {
    expect(open.isBusy(NPC_SPRITE_ID)).toBe(false);
    await openDialog();
    expect(open.isBusy(NPC_SPRITE_ID)).toBe(true);
  });

  test("a dropped socket releases the NPC", async () => {
    await openDialog();
    handler.onSessionClosed({ session: { sessionId: SESSION } });

    expect(open.get(SESSION)).toBeUndefined();
    expect(open.isBusy(NPC_SPRITE_ID)).toBe(false);
  });
});
