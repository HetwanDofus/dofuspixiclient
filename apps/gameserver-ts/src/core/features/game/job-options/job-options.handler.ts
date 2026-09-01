import type { HandlerContext } from "@shared/gateway-adapter/ws-router";
import {
  type JobChangeOptionsRequest,
  JobChangeOptionsRequestSchema,
} from "@dofus/proto/misc_pb";
import { JobsService } from "@modules/jobs/jobs.service";
import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { MessageHandler } from "@shared/gateway-adapter/message-handler.decorator";
import { SessionRegistry } from "@shared/gateway-adapter/session-registry";

/**
 * `JO` — the artisan's terms, and their line in the craftsmen's book.
 *
 * `params` arrives as a string because that is what the 1.29 frame carries;
 * it is a small bitmask and is read as one. Anything unparsable is dropped
 * rather than defaulted: a mis-read "je fais payer" is a scam either way it
 * falls.
 */
@Injectable()
export class JobOptionsHandler {
  private readonly logger = new Logger(JobOptionsHandler.name);

  constructor(
    private readonly sessions: SessionRegistry,
    private readonly jobs: JobsService
  ) {}

  @MessageHandler(JobChangeOptionsRequestSchema)
  async change(
    ctx: HandlerContext,
    msg: JobChangeOptionsRequest
  ): Promise<void> {
    const session = this.sessions.get(ctx.sessionId);

    if (!session?.characterId) {
      return;
    }

    const options = Number.parseInt(msg.params, 10);

    if (!Number.isFinite(options) || options < 0) {
      this.logger.debug(
        `JO: unreadable params "${msg.params}" session=${ctx.sessionId}`
      );
      return;
    }

    const applied = await this.jobs.setOptions(
      ctx.sessionId,
      session.characterId,
      msg.jobId,
      options,
      msg.minSlots
    );

    if (!applied) {
      this.logger.debug(
        `JO: job ${msg.jobId} not held by ${session.characterId}`
      );
    }
  }

  /**
   * Leaving takes the artisan out of every book.
   *
   * The alternative — leaving the row set and filtering the book against the
   * live session registry — would be one more thing to get right on every
   * read, and would leave the database describing a world that no longer
   * exists after a crash.
   */
  @OnEvent("session.closed")
  onSessionClosed({
    session,
  }: {
    session: { characterId?: string | null };
  }): void {
    if (session.characterId) {
      void this.jobs.unlist(session.characterId);
    }
  }
}
