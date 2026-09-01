import type { JobEntry, SkillEntry } from "@modules/jobs/jobs.catalog.service";
import { create } from "@bufbuild/protobuf";
import {
  CrafterSummarySchema,
  ExchangeCrafterListSchema,
} from "@dofus/proto/exchange_pb";
import { ItemToolSchema } from "@dofus/proto/items_pb";
import {
  JobEntrySchema,
  JobLevelSchema,
  JobOptionsSchema,
  JobRemoveSchema,
  JobSkillEntrySchema,
  JobSkillsSchema,
  JobXPEntrySchema,
  JobXPSchema,
} from "@dofus/proto/misc_pb";
import { DofusMessageSchema } from "@dofus/proto/server_messages_pb";
import { JobsCatalogService } from "@modules/jobs/jobs.catalog.service";
import { craftSlotsAtLevel } from "@modules/jobs/jobs.craft-slots";
import { jobXpBounds } from "@modules/jobs/jobs.progression.constants";
import { BASE_JOB_ID } from "@modules/jobs/jobs.rules";
import { Injectable } from "@nestjs/common";
import { JobSkillKind } from "@shared/db/schema";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";

export interface PlayerJobState {
  jobId: number;
  level: number;
  experience: string;
}

/**
 * Telling a client about the jobs its character holds.
 *
 * The whole `J` channel was declared and had no producer (QA-131). The four
 * frames are small and they are all here, in one place, so the panel, the
 * craft window and the interactive menu are never told three different
 * stories about the same job.
 */
@Injectable()
export class JobsFramesService {
  constructor(
    private readonly catalog: JobsCatalogService,
    private readonly frames: GatewayFrameService
  ) {}

  /**
   * `JS` — every job with its skills.
   *
   * `param1` is the number of craft slots the skill offers at the character's
   * current level, which is the only one of the four the 1.29 client reads:
   * it filters recipes on it and colours their rows by it. A harvest skill
   * has no slots and reports zero, exactly as retail does.
   *
   * `param2` is this server's own use of a field 1.29 leaves spare: the
   * level the skill needs. Without it the client can only apply the retail
   * criterion — "do you have the job" — and would offer an Orme to a
   * level-1 Bûcheron, who would click into a silent refusal.
   */
  sendSkills(sessionId: string, jobs: readonly PlayerJobState[]): void {
    this.frames.broadcast(
      [sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "jobSkills",
          value: create(JobSkillsSchema, {
            success: true,
            jobs: [
              // `-Base-` rides along. It is not one of the character's jobs
              // and never appears in `JX`, but a client with no entry for it
              // has no way to know a well is usable — every one of them was
              // greyed until this was sent.
              create(JobEntrySchema, {
                jobId: BASE_JOB_ID,
                skills: this.catalog.runnableBaseSkills().map((skill) =>
                  create(JobSkillEntrySchema, {
                    skillId: skill.id,
                    param1: 0,
                    param2: skill.minLevel,
                  })
                ),
              }),
            ].concat(
              jobs.map((job) =>
                create(JobEntrySchema, {
                  jobId: job.jobId,
                  skills: this.catalog.skillsOfJob(job.jobId).map((skill) =>
                    create(JobSkillEntrySchema, {
                      skillId: skill.id,
                      param1: slotsFor(skill, job.level),
                      param2: skill.minLevel,
                    })
                  ),
                })
              )
            ),
          }),
        },
      })
    );
  }

  /** `JX` — level and the experience window the gauge draws. */
  sendExperience(sessionId: string, jobs: readonly PlayerJobState[]): void {
    this.frames.broadcast(
      [sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "jobXp",
          value: create(JobXPSchema, {
            success: true,
            entries: jobs.map((job) => {
              const bounds = jobXpBounds(job.level);

              return create(JobXPEntrySchema, {
                jobId: job.jobId,
                level: job.level,
                xpMin: BigInt(bounds.min),
                xpCurrent: BigInt(job.experience),
                xpMax: BigInt(bounds.max),
              });
            }),
          }),
        },
      })
    );
  }

  /** `JN` — the "Ton métier %1 passe niveau %2." box. */
  sendLevelUp(sessionId: string, jobId: number, newLevel: number): void {
    this.frames.broadcast(
      [sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "jobLevel",
          value: create(JobLevelSchema, { jobId, newLevel }),
        },
      })
    );
  }

  /** `JR` — the job is gone; the client drops it from its list. */
  sendRemoved(sessionId: string, jobId: number): void {
    this.frames.broadcast(
      [sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "jobRemove",
          value: create(JobRemoveSchema, { jobId }),
        },
      })
    );
  }

  /**
   * `OT` — which tool is in the weapon slot, if any.
   *
   * The client greys a harvest action out on this alone, so an unequip has to
   * send it with `hasTool: false` rather than simply stop sending it, and it
   * names the job because "is this a tool" is not the question — "is this
   * *my Bûcheron's* tool" is, and `jobs_data.tools` has no client copy.
   *
   * A template could serve two jobs in principle; none in the imported
   * referential does, so the first match is the answer.
   */
  sendTool(sessionId: string, toolItemId: number | null, jobId = 0): void {
    this.frames.broadcast(
      [sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "itemTool",
          value: create(ItemToolSchema, {
            toolItemId: toolItemId ?? 0,
            hasTool: toolItemId !== null,
            jobId,
          }),
        },
      })
    );
  }

  /**
   * `JO` — the artisan's terms, echoed back.
   *
   * The first field is an **index into the client's own job list**, not a job
   * id: `aks/Job.as:onOptions` writes `Player.Jobs[index].options`. That list
   * is the one `JS` sent, in the order it sent it, so the index is the
   * position of the job in `statesFor`'s ordering — which is why the caller
   * passes it rather than this deriving it from an id it cannot order.
   */
  sendOptions(
    sessionId: string,
    jobIndex: number,
    options: number,
    minSlots: number
  ): void {
    this.frames.broadcast(
      [sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "jobOptions",
          value: create(JobOptionsSchema, {
            jobIndex,
            option1: options,
            option2: minSlots,
          }),
        },
      })
    );
  }

  /** `EJ` — who is offering that job's services right now. */
  sendCrafterList(
    sessionId: string,
    jobId: number,
    crafters: readonly {
      playerId: string;
      name: string;
      level: number;
      minSlots: number;
      options: number;
    }[]
  ): void {
    this.frames.broadcast(
      [sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "exchangeCrafterList",
          value: create(ExchangeCrafterListSchema, {
            jobId,
            crafters: crafters.map((crafter) =>
              create(CrafterSummarySchema, {
                playerId: BigInt(crafter.playerId),
                name: crafter.name,
                level: crafter.level,
                minLevel: crafter.minSlots,
                // `free_slots` in the retail record is "will take work
                // now"; a listed artisan always will, which is what being
                // listed means.
                freeSlots: true,
              })
            ),
          }),
        },
      })
    );
  }

  /** `JS` and `JX`, which always travel together. */
  sendAll(sessionId: string, jobs: readonly PlayerJobState[]): void {
    this.sendSkills(sessionId, jobs);
    this.sendExperience(sessionId, jobs);
  }
}

function slotsFor(skill: SkillEntry, jobLevel: number): number {
  return skill.kind === JobSkillKind.Craft ? craftSlotsAtLevel(jobLevel) : 0;
}

/** Kept so the frame builder does not import a job it never reads. */
export type { JobEntry };
