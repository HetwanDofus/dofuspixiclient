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
import { SessionEvictionService } from "@shared/gateway-adapter/session-eviction.service";
import { SessionRegistry } from "@shared/gateway-adapter/session-registry";

@Injectable()
export class LoginHandler {
  private readonly logger = new Logger(LoginHandler.name);

  constructor(
    private readonly repo: LoginRepository,
    private readonly sessions: SessionRegistry,
    private readonly frames: GatewayFrameService,
    private readonly eviction: SessionEvictionService
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

    const ok = await Bun.password.verify(
      msg.encryptedPassword,
      account.pwdHash
    );

    if (!ok) {
      return this.reject(ctx, LoginError.INVALID_CREDENTIALS);
    }

    const session = this.sessions.get(ctx.sessionId);

    const addr = session?.remoteAddr;
    await this.repo.markLoggedIn(account.id, addr && addr !== "unknown" ? addr : null);

    // One session per account. Deliberately *after* the password and ban
    // checks: evicting on a failed attempt would let anyone disconnect a player
    // by guessing their username.
    this.eviction.evictAccount(account.id, ctx.sessionId);

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
