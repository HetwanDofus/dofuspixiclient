import type { TransactionalAdapterKysely } from "@nestjs-cls/transactional-adapter-kysely";
import type { DB } from "@shared/db/schema";
import { Injectable } from "@nestjs/common";
import { TransactionHost } from "@nestjs-cls/transactional";
import { JobSkillKind } from "@shared/db/schema";

/**
 * Reads over the jobs referential and a character's own progress.
 *
 * The referential (`jobs`, `job_skills`, `job_tools`) is rebuilt only by
 * `scripts/import-starloco-jobs.ts` and is immutable at runtime, so
 * everything here that touches it is a plain read — `JobsCacheService` is the
 * one that keeps it in memory.
 */
@Injectable()
export class JobsRepository {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterKysely<DB>>
  ) {}

  /** Every job the referential knows, with its family. */
  findAllJobs() {
    return this.txHost.tx
      .selectFrom("jobs")
      .select(["id", "name", "gfxId", "specializationOf", "maxLevel"])
      .execute();
  }

  /** Every skill, of every kind — the greyed-out ones need a label too. */
  findAllSkills() {
    return this.txHost.tx
      .selectFrom("jobSkills")
      .select([
        "id",
        "jobId",
        "name",
        "kind",
        "minLevel",
        "harvestItemId",
        "harvestXp",
        "fixedDurationMs",
        "quantityMin",
        "quantityMax",
        "criteria",
      ])
      .execute();
  }

  /** `(jobId, templateId)` pairs — which equipped item is whose tool. */
  findAllTools() {
    return this.txHost.tx
      .selectFrom("jobTools")
      .select(["jobId", "templateId"])
      .execute();
  }

  /** A character's jobs, with the family each belongs to. */
  findPlayerJobs(playerId: string) {
    return this.txHost.tx
      .selectFrom("playerJobs")
      .innerJoin("jobs", "jobs.id", "playerJobs.jobId")
      .select([
        "playerJobs.jobId",
        "playerJobs.level",
        "playerJobs.experience",
        "jobs.specializationOf",
        "jobs.name",
      ])
      .where("playerJobs.playerId", "=", playerId)
      .orderBy("playerJobs.jobId")
      .execute();
  }

  /** The artisan's terms, for the book and for a co-operative craft. */
  findOptions(playerId: string, jobId: number) {
    return this.txHost.tx
      .selectFrom("playerJobs")
      .select(["jobId", "level", "options", "minSlots", "listed"])
      .where("playerId", "=", playerId)
      .where("jobId", "=", jobId)
      .executeTakeFirst();
  }

  async setOptions(
    playerId: string,
    jobId: number,
    options: number,
    minSlots: number,
    listed: boolean
  ): Promise<void> {
    await this.txHost.tx
      .updateTable("playerJobs")
      .set({ options, minSlots, listed })
      .where("playerId", "=", playerId)
      .where("jobId", "=", jobId)
      .execute();
  }

  /** Drops the character out of every book — a logout, or a lost tool. */
  async unlist(playerId: string, jobId?: number): Promise<void> {
    let query = this.txHost.tx
      .updateTable("playerJobs")
      .set({ listed: false })
      .where("playerId", "=", playerId)
      .where("listed", "=", true);

    if (jobId !== undefined) {
      query = query.where("jobId", "=", jobId);
    }

    await query.execute();
  }

  /**
   * Everyone currently offering that job's services.
   *
   * `listed` is only ever true for a connected character — every path that
   * ends a session clears it — so this is a straight read rather than a join
   * against the session registry.
   */
  findListed(jobId: number) {
    return this.txHost.tx
      .selectFrom("playerJobs")
      .innerJoin("players", "players.id", "playerJobs.playerId")
      .select([
        "playerJobs.playerId",
        "playerJobs.jobId",
        "playerJobs.level",
        "playerJobs.options",
        "playerJobs.minSlots",
        "players.name",
      ])
      .where("playerJobs.jobId", "=", jobId)
      .where("playerJobs.listed", "=", true)
      .orderBy("playerJobs.level", "desc")
      .limit(100)
      .execute();
  }

  findPlayerJob(playerId: string, jobId: number) {
    return this.txHost.tx
      .selectFrom("playerJobs")
      .select(["jobId", "level", "experience"])
      .where("playerId", "=", playerId)
      .where("jobId", "=", jobId)
      .executeTakeFirst();
  }

  async insertPlayerJob(playerId: string, jobId: number): Promise<void> {
    await this.txHost.tx
      .insertInto("playerJobs")
      .values({ playerId, jobId, level: 1, experience: "0" })
      .onConflict((oc) => oc.columns(["playerId", "jobId"]).doNothing())
      .execute();
  }

  async deletePlayerJob(playerId: string, jobId: number): Promise<void> {
    await this.txHost.tx
      .deleteFrom("playerJobs")
      .where("playerId", "=", playerId)
      .where("jobId", "=", jobId)
      .execute();
  }

  /**
   * Banks experience and returns the running total.
   *
   * The addition happens in SQL rather than read-modify-write on purpose:
   * two harvests finishing in the same tick would otherwise each write the
   * value they read, and one of the two gains would vanish.
   */
  async addExperience(
    playerId: string,
    jobId: number,
    amount: number
  ): Promise<string | null> {
    const row = await this.txHost.tx
      .updateTable("playerJobs")
      .set((eb) => ({
        experience: eb("experience", "+", String(amount)),
      }))
      .where("playerId", "=", playerId)
      .where("jobId", "=", jobId)
      .returning("experience")
      .executeTakeFirst();

    return row?.experience ?? null;
  }

  async setLevel(
    playerId: string,
    jobId: number,
    level: number
  ): Promise<void> {
    await this.txHost.tx
      .updateTable("playerJobs")
      .set({ level })
      .where("playerId", "=", playerId)
      .where("jobId", "=", jobId)
      .execute();
  }

  /** The placed resource on this cell, if the import found one there. */
  findGatherable(mapId: number, cellId: number) {
    return this.txHost.tx
      .selectFrom("jobGatherableCells")
      .innerJoin("jobSkills", "jobSkills.id", "jobGatherableCells.skillId")
      .select([
        "jobGatherableCells.mapId",
        "jobGatherableCells.cellId",
        "jobGatherableCells.skillId",
        "jobGatherableCells.resourceItemId",
        "jobGatherableCells.respawnSeconds",
        "jobSkills.jobId",
        "jobSkills.minLevel",
        "jobSkills.harvestXp",
        "jobSkills.fixedDurationMs",
        "jobSkills.quantityMin",
        "jobSkills.quantityMax",
      ])
      .where("jobGatherableCells.mapId", "=", mapId)
      .where("jobGatherableCells.cellId", "=", cellId)
      .where("jobSkills.kind", "=", JobSkillKind.Harvest)
      .executeTakeFirst();
  }
}
