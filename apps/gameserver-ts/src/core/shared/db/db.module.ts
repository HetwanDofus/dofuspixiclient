import type { Env } from "@shared/config/env.schema";
import { Global, Inject, Module, type OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ClsPluginTransactional } from "@nestjs-cls/transactional";
import { TransactionalAdapterKysely } from "@nestjs-cls/transactional-adapter-kysely";
import { createDatabase, type Database } from "@shared/db/database";
import { ClsModule } from "nestjs-cls";

export const DATABASE = Symbol.for("dofus:database");

@Global()
@Module({
  providers: [
    {
      provide: DATABASE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): Database =>
        createDatabase(config.get("DATABASE_URL", { infer: true })),
    },
  ],
  exports: [DATABASE],
})
export class KyselyInstanceModule implements OnModuleDestroy {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async onModuleDestroy() {
    await this.db.destroy();
  }
}

@Global()
@Module({
  imports: [
    KyselyInstanceModule,
    ClsModule.forRoot({
      plugins: [
        new ClsPluginTransactional({
          imports: [KyselyInstanceModule],
          adapter: new TransactionalAdapterKysely({
            kyselyInstanceToken: DATABASE,
          }),
        }),
      ],
    }),
  ],
  exports: [KyselyInstanceModule],
})
export class DatabaseModule {}
