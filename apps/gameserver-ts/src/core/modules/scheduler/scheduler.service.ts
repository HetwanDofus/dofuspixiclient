import type { Serializable } from "@shared/handoff/handoff.coordinator";
import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { HandoffPart } from "@shared/handoff/handoff-part.decorator";

// Wall-clock scheduler. Callers register jobs that fire a named event at
// `dueAt`. State serializes through blue/green handoff, so timers re-arm
// against the remaining delay after a restart — jobs that fell due while
// the process was down fire immediately on restore.

/** The largest delay `setTimeout` can hold without overflowing: 2^31-1 ms. */
const MAX_TIMEOUT = 2_147_483_647;

export interface ScheduledJob<T = unknown> {
  id: string;
  dueAt: number;
  channel: string;
  payload: T;
}

@Injectable()
@HandoffPart()
export class SchedulerService
  implements Serializable<ScheduledJob[]>, OnModuleDestroy
{
  readonly name = "scheduler.jobs";

  private readonly logger = new Logger(SchedulerService.name);
  private readonly jobs = new Map<string, ScheduledJob>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly events: EventEmitter2) {}

  schedule(job: ScheduledJob): void {
    this.cancel(job.id);
    this.jobs.set(job.id, job);
    this.arm(job);
  }

  cancel(id: string): boolean {
    const timer = this.timers.get(id);

    if (timer) {
      clearTimeout(timer);
    }

    this.timers.delete(id);

    return this.jobs.delete(id);
  }

  has(id: string): boolean {
    return this.jobs.has(id);
  }

  onModuleDestroy(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }

    this.timers.clear();
  }

  private arm(job: ScheduledJob): void {
    const delay = Math.max(0, job.dueAt - Date.now());

    // `setTimeout` stores its delay in a signed 32-bit integer: anything
    // past ~24.8 days overflows and the callback runs **immediately**,
    // silently. An auction lot listed for 30 days therefore expired the
    // instant it was created and its goods went straight to the seller's
    // bank — which is how this was found. A long wait is re-armed in
    // slices instead, and the job stays in `jobs` throughout so `cancel`,
    // `has` and the handoff all keep working across the slices.
    if (delay > MAX_TIMEOUT) {
      this.timers.set(
        job.id,
        setTimeout(() => this.arm(job), MAX_TIMEOUT)
      );
      return;
    }

    this.timers.set(
      job.id,
      setTimeout(() => this.fire(job), delay)
    );
  }

  private fire(job: ScheduledJob): void {
    this.jobs.delete(job.id);
    this.timers.delete(job.id);
    this.events.emit(job.channel, job.payload);
  }

  serialize(): ScheduledJob[] {
    return Array.from(this.jobs.values());
  }

  restore(jobs: ScheduledJob[]): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }

    this.timers.clear();
    this.jobs.clear();

    for (const job of jobs) {
      this.jobs.set(job.id, job);
      this.arm(job);
    }

    this.logger.log(`restored ${jobs.length} scheduled job(s)`);
  }
}
