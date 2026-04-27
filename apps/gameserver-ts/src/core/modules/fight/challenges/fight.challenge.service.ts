import type { FightChallenge } from "@modules/fight/challenges/fight.challenge.base";
import type { Fight } from "@modules/fight/core/fight.entity";
import type { TransactionalAdapterKysely } from "@nestjs-cls/transactional-adapter-kysely";
import type { DB } from "@shared/db/schema";
import { create } from "@bufbuild/protobuf";
import { GameActionSchema } from "@dofus/proto/game_pb";
import { DofusMessageSchema } from "@dofus/proto/server_messages_pb";
import { Injectable, Logger } from "@nestjs/common";
import { TransactionHost } from "@nestjs-cls/transactional";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";

@Injectable()
export class FightChallengeService {
  private readonly logger = new Logger(FightChallengeService.name);
  private challengeFactories = new Map<number, () => FightChallenge>();
  private templatesCache: Array<{
    id: number;
    name: string;
    xpBonusPct: number;
    dropBonusPct: number;
    gainPerMobPct: number;
    conditionsMask: number;
  }> | null = null;

  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterKysely<DB>>,
    private readonly frames: GatewayFrameService
  ) {}

  registerFactory(id: number, factory: () => FightChallenge): void {
    this.challengeFactories.set(id, factory);
  }

  private async loadTemplates() {
    if (this.templatesCache) {
      return this.templatesCache;
    }
    this.templatesCache = await this.txHost.tx
      .selectFrom("fightChallengeTemplates")
      .selectAll()
      .execute();
    return this.templatesCache;
  }

  broadcastChallengeResult(fight: Fight, challenge: FightChallenge): void {
    const targets = fight.allSessions();
    const result = challenge.won
      ? `OK${challenge.challengeId}`
      : `KO${challenge.challengeId}`;
    this.frames.broadcast(
      targets,
      create(DofusMessageSchema, {
        payload: {
          case: "gameAction",
          value: create(GameActionSchema, {
            sequenceId: 0,
            actionType: 0,
            spriteId: "0",
            rawParams: `CW;${result}`,
          }),
        },
      })
    );
  }

  async assignChallenges(fight: Fight, count = 1): Promise<FightChallenge[]> {
    const templates = await this.loadTemplates();

    if (templates.length === 0) {
      return [];
    }

    const available = templates.filter((t) =>
      this.challengeFactories.has(t.id)
    );
    const shuffled = available.sort(() => Math.random() - 0.5);
    const picked = shuffled.slice(0, count);

    const challenges: FightChallenge[] = [];
    const targets = fight.allSessions();

    for (const template of picked) {
      const factory = this.challengeFactories.get(template.id);
      if (!factory) {
        continue;
      }
      const challenge = factory();
      challenge.xpBonusPct = template.xpBonusPct;
      challenge.dropBonusPct = template.dropBonusPct;
      fight.modules.add(challenge);
      challenges.push(challenge);

      // Broadcast challenge assignment
      const hasTarget = challenge.target ? 1 : 0;
      const targetId = challenge.target?.id ?? 0;
      this.frames.broadcast(
        targets,
        create(DofusMessageSchema, {
          payload: {
            case: "gameAction",
            value: create(GameActionSchema, {
              sequenceId: 0,
              actionType: 0,
              spriteId: "0",
              rawParams: `Cd;${challenge.challengeId};${hasTarget};${targetId};${challenge.xpBonusPct};0;${challenge.dropBonusPct};0;`,
            }),
          },
        })
      );

      this.logger.debug(
        `Assigned challenge ${template.id} (${template.name}) to fight ${fight.id}`
      );
    }

    return challenges;
  }
}
