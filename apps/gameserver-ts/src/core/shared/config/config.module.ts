import { Global, Module } from "@nestjs/common";
import { ConfigModule as NestConfigModule } from "@nestjs/config";
import { type Env, envSchema } from "@shared/config/env.schema";

function validate(raw: Record<string, unknown>): Env {
  const normalized = { MODE: "game", ...raw };
  const parsed = envSchema.safeParse(normalized);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");

    throw new Error(`invalid environment: ${issues}`);
  }

  return parsed.data;
}

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate,
    }),
  ],
})
export class AppConfigModule {}
