/**
 * Who may learn what — the 1.29 slot rules, kept pure so they are testable
 * without a database.
 *
 * A character holds at most three ordinary jobs and, separately, at most
 * three magus specialisations. The two families do not share slots: a
 * specialisation is attached to its parent job (`jobs.specialization_of`) and
 * occupies a small slot of its own.
 *
 * The gate on a *new* job is not the count alone. Every job **and** every
 * specialisation already held must be at level 30 or better, which is what
 * stops a character collecting three level-1 jobs and abandoning them.
 */

/** Ordinary jobs a character may hold at once. */
export const MAX_BASE_JOBS = 3;

/** Magus specialisations a character may hold at once. */
export const MAX_SPECIALISATIONS = 3;

/** Every job already held must be at least this level before adding one. */
export const LEVEL_TO_UNLOCK_A_SLOT = 30;

/** A specialisation is only offered once its parent job reaches this level. */
export const LEVEL_TO_SPECIALISE = 65;

/**
 * `-Base-`, the bundle's job 1. It is not a job: it carries the actions
 * anyone can perform (drawing water from a well, picking up potatoes) and
 * every character has it implicitly. It never occupies a slot.
 */
export const BASE_JOB_ID = 1;

export interface HeldJob {
  jobId: number;
  level: number;
  /** `jobs.specialization_of` — 0 for an ordinary job. */
  specializationOf: number;
}

export type LearnDenialReason =
  /** The character already has it. */
  | "already-known"
  /** `-Base-`, or an id no job carries. */
  | "not-learnable"
  /** Three of that family already. */
  | "no-slot-left"
  /** Something already held is below level 30. */
  | "another-job-too-low"
  /** A specialisation whose parent job is missing or below 65. */
  | "parent-job-too-low";

export type LearnResult =
  | { ok: true }
  | { ok: false; reason: LearnDenialReason };

export interface LearnCheckInput {
  /** The job being learned, as the referential describes it. */
  candidate: { jobId: number; specializationOf: number } | null;
  held: readonly HeldJob[];
}

/**
 * Checks every rule, in the order that gives the most useful refusal first:
 * "you already have it" is a different problem from "you have no room", which
 * is a different problem from "you have room but you have not earned it".
 */
export function canLearn({ candidate, held }: LearnCheckInput): LearnResult {
  if (!candidate || candidate.jobId === BASE_JOB_ID) {
    return { ok: false, reason: "not-learnable" };
  }

  if (held.some((j) => j.jobId === candidate.jobId)) {
    return { ok: false, reason: "already-known" };
  }

  const slotted = held.filter((j) => j.jobId !== BASE_JOB_ID);
  const isSpecialisation = candidate.specializationOf > 0;

  const sameFamily = slotted.filter(
    (j) => j.specializationOf > 0 === isSpecialisation
  );
  const limit = isSpecialisation ? MAX_SPECIALISATIONS : MAX_BASE_JOBS;

  if (sameFamily.length >= limit) {
    return { ok: false, reason: "no-slot-left" };
  }

  if (isSpecialisation) {
    const parent = slotted.find((j) => j.jobId === candidate.specializationOf);

    if (!parent || parent.level < LEVEL_TO_SPECIALISE) {
      return { ok: false, reason: "parent-job-too-low" };
    }
  }

  // The first job of either family is free; after that, everything already
  // held — both families, deliberately — has to have reached 30.
  if (
    sameFamily.length > 0 &&
    slotted.some((j) => j.level < LEVEL_TO_UNLOCK_A_SLOT)
  ) {
    return { ok: false, reason: "another-job-too-low" };
  }

  return { ok: true };
}
