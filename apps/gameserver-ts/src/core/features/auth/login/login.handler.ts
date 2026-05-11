import type { HandlerContext } from "@shared/gateway-adapter/ws-router";
import { create } from "@bufbuild/protobuf";
import {
  AccountLoginResponseSchema,
  type AccountSendIdentity,
  AccountSendIdentitySchema,
  LoginError,
} from "@dofus/proto/account_pb";
import { DofusMessageSchema } from "@dofus/proto/server_messages_pb";
import { LoginRepository } from "@features/auth/login/login.repository";
import { Injectable, Logger } from "@nestjs/common";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";
import { MessageHandler } from "@shared/gateway-adapter/message-handler.decorator";
import { SessionRegistry } from "@shared/gateway-adapter/session-registry";

@Injectable()
export class LoginHandler {
  private readonly logger = new Logger(LoginHandler.name);

  constructor(
    private readonly repo: LoginRepository,
    private readonly sessions: SessionRegistry,
    private readonly frames: GatewayFrameService
  ) {}

  @MessageHandler(AccountSendIdentitySchema)
  async handle(ctx: HandlerContext, msg: AccountSendIdentity): Promise<void> {
    const account = await this.repo.findByUsername(msg.username);

    if (!account) {
      return this.reject(ctx, LoginError.INVALID_CREDENTIALS);
    }

    if (account.isBanned) {
      return this.reject(ctx, LoginError.BANNED);
    }

    // Defensive: Bun.password.verify throws AggregateError when the
    // stored hash isn't in a recognized algorithm format (every algo
    // it tries rejects → all errors aggregated). That happens when
    // a row was inserted with a pre-hashed-by-some-other-tool string,
    // a fixture left a placeholder, or a migration emptied the column.
    // Treat that as bad credentials rather than letting the dispatch
    // wrapper log a context-free AggregateError.
    if (!account.pwdHash || typeof account.pwdHash !== "string") {
      this.logger.warn(
        `login refused: account ${account.id} has empty/invalid pwdHash`
      );
      return this.reject(ctx, LoginError.INVALID_CREDENTIALS);
    }

    let ok = false;
    try {
      ok = await Bun.password.verify(msg.encryptedPassword, account.pwdHash);
    } catch (err) {
      // Malformed hash format → AggregateError (Bun tries multiple
      // algorithms and aggregates rejections). Log the inner causes
      // and reject as bad creds — never propagate to the dispatcher.
      const causes =
        err instanceof AggregateError
          ? err.errors
              .map((e) => (e instanceof Error ? e.message : String(e)))
              .join(" | ")
          : err instanceof Error
            ? err.message
            : String(err);
      this.logger.error(
        `Bun.password.verify failed for account ${account.id}: ${causes}`
      );
      return this.reject(ctx, LoginError.INVALID_CREDENTIALS);
    }

    if (!ok) {
      return this.reject(ctx, LoginError.INVALID_CREDENTIALS);
    }

    const session = this.sessions.get(ctx.sessionId);

    const addr = session?.remoteAddr;
    await this.repo.markLoggedIn(account.id, addr && addr !== "unknown" ? addr : null);

    this.sessions.attachAccount(ctx.sessionId, account.id);

    this.logger.log(
      `login ok: ${msg.username} → account=${account.id} session=${ctx.sessionId}`
    );

    this.frames.broadcast(
      [ctx.sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "accountLogin",
          value: create(AccountLoginResponseSchema, {
            success: true,
            isAuthorized: true,
          }),
        },
      })
    );
  }

  private reject(ctx: HandlerContext, errorCode: LoginError): void {
    this.frames.broadcast(
      [ctx.sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "accountLogin",
          value: create(AccountLoginResponseSchema, {
            success: false,
            errorCode,
          }),
        },
      })
    );
  }
}
