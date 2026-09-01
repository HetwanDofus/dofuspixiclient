import type { PlayerJobState } from "@modules/jobs/jobs.frames.service";
import type { HeldJob, LearnDenialReason } from "@modules/jobs/jobs.rules";
import { JobsCatalogService } from "@modules/jobs/jobs.catalog.service";
import { JobsFramesService } from "@modules/jobs/jobs.frames.service";
import { jobPodsBonus } from "@modules/jobs/jobs.pods";
import {
  jobLevelForXp,
  MAX_JOB_LEVEL,
} from "@modules/jobs/jobs.progression.constants";
import { JobsRepository } from "@modules/jobs/jobs.repository";
import { canLearn } from "@modules/jobs/jobs.rules";
import { Injectable, Logger } from "@nestjs/common";
import { Transactional } from "@nestjs-cls/transactional";

export type LearnOutcome =
  | { ok: true; jobId: number }
  | { ok: false; reason: LearnDenialReason };

export interface ExperienceGain {
  jobId: number;
  experience: string;
  level: number;
  /** Set only when the gain crossed a threshold. */
  leveledTo: number | null;
}

/**
 * A character's jobs: learning one, forgetting one, and banking experience.
 *
 * The rules themselves live in `jobs.rules.ts` and the curve in
 * `jobs.progression.constants.ts`; what is here is the part that needs a
 * database and a socket. Everything that writes runs in a transaction, for
 * the same reason the fight's reward distribution does: a level gained and
 * the experience that gained it must not be able to disagree.
 */
@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private readonly repo: JobsRepository,
    private readonly catalog: JobsCatalogService,
    private readonly frames: JobsFramesService
  ) {}

  /** The jobs a character holds, in the shape the frames want. */
  async statesFor(playerId: string): Promise<PlayerJobState[]> {
    const rows = await this.repo.findPlayerJobs(playerId);

    return rows.map((row) => ({
      jobId: row.jobId,
      level: row.level,
      experience: row.experience,
    }));
  }

  /** The carrying capacity these jobs are worth — see QA-133. */
  async podsBonus(playerId: string): Promise<number> {
    const rows = await this.repo.findPlayerJobs(playerId);

    return jobPodsBonus(rows.map((row) => row.level));
  }

  /** `JS` + `JX`, sent on entering the game and after every change. */
  async pushAll(sessionId: string, playerId: string): Promise<void> {
    await this.catalog.load();
    this.frames.sendAll(sessionId, await this.statesFor(playerId));
  }

  @Transactional()
  async learn(
    sessionId: string,
    playerId: string,
    jobId: number
  ): Promise<LearnOutcome> {
    await this.catalog.load();

    const job = this.catalog.job(jobId);
    const rows = await this.repo.findPlayerJobs(playerId);
    const held: HeldJob[] = rows.map((row) => ({
      jobId: row.jobId,
      level: row.level,
      specializationOf: row.specializationOf,
    }));

    const verdict = canLearn({
      candidate: job
        ? { jobId: job.id, specializationOf: job.specializationOf }
        : null,
      held,
    });

    if (!verdict.ok) {
      this.logger.debug(
        `learn: player=${playerId} job=${jobId} refused (${verdict.reason})`
      );
      return verdict;
    }

    await this.repo.insertPlayerJob(playerId, jobId);
    this.frames.sendAll(sessionId, await this.statesFor(playerId));

    this.logger.log(`learn: player=${playerId} learned "${job?.name}"`);

    return { ok: true, jobId };
  }

  @Transactional()
  async forget(
    sessionId: string,
    playerId: string,
    jobId: number
  ): Promise<boolean> {
    const existing = await this.repo.findPlayerJob(playerId, jobId);

    if (!existing) {
      return false;
    }

    await this.repo.deletePlayerJob(playerId, jobId);
    this.frames.sendRemoved(sessionId, jobId);
    this.frames.sendAll(sessionId, await this.statesFor(playerId));

    return true;
  }

  /**
   * Banks experience and works out whether it bought a level.
   *
   * The addition is done in SQL (`JobsRepository.addExperience`) so two gains
   * landing in the same tick cannot overwrite each other; the level is then
   * derived from the *returned* total rather than from the one this call
   * happened to read.
   */
  @Transactional()
  async addExperience(
    playerId: string,
    jobId: number,
    amount: number
  ): Promise<ExperienceGain | null> {
    if (amount <= 0) {
      return null;
    }

    const existing = await this.repo.findPlayerJob(playerId, jobId);

    if (!existing) {
      return null;
    }

    if (existing.level >= MAX_JOB_LEVEL) {
      return {
        jobId,
        experience: existing.experience,
        level: existing.level,
        leveledTo: null,
      };
    }

    const experience = await this.repo.addExperience(playerId, jobId, amount);

    if (experience === null) {
      return null;
    }

    const level = jobLevelForXp(Number(experience));
    const leveledTo = level > existing.level ? level : null;

    if (leveledTo !== null) {
      await this.repo.setLevel(playerId, jobId, level);
    }

    return { jobId, experience, level, leveledTo };
  }

  /**
   * `JO` — the artisan sets their terms, and is listed by the act of doing
   * so.
   *
   * 1.29 asks for this again at every connection, and losing the tool drops
   * it: the craftsmen's book is a "who is working right now" board, not a
   * profile. `JobChangeOptionsRequest` carries no separate "list me" flag
   * for exactly that reason — sending it *is* the registration, which is the
   * reading under which "activer à chaque connexion" is a description of the
   * protocol rather than an extra step.
   */
  // Deliberately not `@Transactional`: one row is written, and the read
  // before it decides only whether to write at all. A transaction here
  // would buy nothing and would make the rule untestable without a database.
  async setOptions(
    sessionId: string,
    playerId: string,
    jobId: number,
    options: number,
    minSlots: number
  ): Promise<boolean> {
    const held = await this.repo.findPlayerJob(playerId, jobId);

    if (!held) {
      return false;
    }

    // `JobOptions` clamps anything below 2 up to 2 on its side; matching it
    // here keeps the number the artisan sees and the number the server
    // enforces the same one.
    const floor = Math.max(2, Math.trunc(minSlots));

    await this.repo.setOptions(playerId, jobId, options, floor, true);

    const states = await this.statesFor(playerId);
    const index = states.findIndex((state) => state.jobId === jobId);

    this.frames.sendOptions(sessionId, Math.max(0, index), options, floor);

    return true;
  }

  /**
   * Take the character out of every craftsmen's book.
   *
   * Called on a logout and whenever the tool leaves the weapon slot. Both
   * are 1.29's own rules, and both matter for the same reason: a book full
   * of artisans who are not there is worse than no book.
   */
  async unlist(playerId: string, jobId?: number): Promise<void> {
    await this.repo.unlist(playerId, jobId);
  }

  /**
   * Unlist every job but `keep`, which is the tool currently worn.
   *
   * Passing `null` unlists all of them, which is what an empty weapon slot
   * means.
   */
  async unlistExcept(playerId: string, keep: number | null): Promise<void> {
    const held = await this.repo.findPlayerJobs(playerId);

    for (const job of held) {
      if (job.jobId !== keep) {
        await this.repo.unlist(playerId, job.jobId);
      }
    }
  }

  /** `EJF` — who is offering that job right now. */
  async sendCrafterList(sessionId: string, jobId: number): Promise<void> {
    const crafters = await this.repo.findListed(jobId);

    this.frames.sendCrafterList(sessionId, jobId, crafters);
  }

  /** Announces a gain: `JX` always, `JN` only when a level was crossed. */
  async announceGain(
    sessionId: string,
    playerId: string,
    gain: ExperienceGain
  ) {
    this.frames.sendExperience(sessionId, await this.statesFor(playerId));

    if (gain.leveledTo !== null) {
      this.frames.sendLevelUp(sessionId, gain.jobId, gain.leveledTo);
      // A new level means new craft slots, so the skill list is stale.
      this.frames.sendSkills(sessionId, await this.statesFor(playerId));
    }
  }
}
