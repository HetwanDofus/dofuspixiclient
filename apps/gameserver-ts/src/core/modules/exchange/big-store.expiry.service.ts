import type { BigStoreExpiryPayload } from "@modules/exchange/big-store.expiry";
import type { OnModuleInit } from "@nestjs/common";
import {
  BIG_STORE_EXPIRE,
  expiryJobId,
} from "@modules/exchange/big-store.expiry";
import { BigStoreFlow } from "@modules/exchange/big-store.flow";
import { SchedulerService } from "@modules/scheduler/scheduler.service";
import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";

/**
 * Lots come off the shelf when their time is up.
 *
 * `SchedulerService` already survives a blue/green restart and fires
 * whatever fell due while the process was down, so a watch-mode reload
 * needs nothing here. A **cold** start is the case it cannot cover — the
 * handoff has nothing to restore from — which is why every outstanding
 * listing is re-armed from the database on boot. Two sources, one
 * scheduler: `schedule()` replaces a job with the same id, so arming a
 * listing twice is harmless.
 *
 * A listing whose deadline has already passed is scheduled at `dueAt` in
 * the past, and the scheduler clamps the delay to zero — it expires on
 * the next tick rather than living forever because the server was down
 * when it should have gone.
 */
@Injectable()
export class BigStoreExpiryService implements OnModuleInit {
  private readonly logger = new Logger(BigStoreExpiryService.name);

  constructor(
    private readonly flow: BigStoreFlow,
    private readonly scheduler: SchedulerService
  ) {}

  async onModuleInit(): Promise<void> {
    const listings = await this.flow.pending();

    for (const listing of listings) {
      this.arm(listing.id, new Date(listing.expiresAt).getTime());
    }

    if (listings.length > 0) {
      this.logger.log(`armed ${listings.length} auction listing expiries`);
    }
  }

  private arm(listingId: string, dueAt: number): void {
    this.scheduler.schedule({
      id: expiryJobId(listingId),
      dueAt,
      channel: BIG_STORE_EXPIRE,
      payload: { listingId } satisfies BigStoreExpiryPayload,
    });
  }

  @OnEvent(BIG_STORE_EXPIRE)
  async onExpire({ listingId }: BigStoreExpiryPayload): Promise<void> {
    await this.flow.expire(listingId);
  }
}
