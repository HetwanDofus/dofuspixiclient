import "reflect-metadata";

import type { AuthEnv, Env, GameEnv } from "@shared/config/env.schema";
import { AppModule } from "@core/app.module";
import { ShutdownSignal } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";
import { match } from "ts-pattern";

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["log", "warn", "error"],
  });

  app.enableShutdownHooks([ShutdownSignal.SIGINT, ShutdownSignal.SIGTERM]);

  await app.init();

  const mode = app.get(ConfigService<Env, true>).get("MODE", { infer: true });

  match(mode)
    .with("game", () => {
      const config = app.get(ConfigService<GameEnv, true>);
      const sock = config.get("CORE_SOCK", { infer: true });
      const version = config.get("CORE_VERSION", { infer: true });

      app.get(GatewayFrameService).listen(sock);
      console.log(`[gamed] listening on ${sock} (version=${version})`);
    })
    .with("auth", () => {
      const config = app.get(ConfigService<AuthEnv, true>);
      const sock = config.get("AUTH_SOCK", { infer: true });

      app.get(GatewayFrameService).listen(sock);
      console.log(`[authd] listening on ${sock}`);
    })
    .exhaustive();
}

void bootstrap();
