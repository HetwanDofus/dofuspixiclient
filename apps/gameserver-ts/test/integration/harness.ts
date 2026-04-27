import { promises as fs } from "node:fs";
import * as path from "node:path";
import { join } from "node:path";

import type { DB } from "@core/shared/db/schema.ts";
import { DATABASE } from "@core/shared/db/db.module.ts";
import { Global, Module } from "@nestjs/common";
import { ClsPluginTransactional } from "@nestjs-cls/transactional";
import { TransactionalAdapterKysely } from "@nestjs-cls/transactional-adapter-kysely";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import {
  CamelCasePlugin,
  FileMigrationProvider,
  Kysely,
  Migrator,
  PostgresDialect,
} from "kysely";
import { ClsModule } from "nestjs-cls";
import { Pool } from "pg";

let container: StartedPostgreSqlContainer | null = null;
let db: Kysely<DB> | null = null;

async function runMigrations(database: Kysely<DB>): Promise<void> {
  const migrator = new Migrator({
    db: database,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: join(process.cwd(), "migrations"),
    }),
  });

  const { error, results } = await migrator.migrateToLatest();

  if (results) {
    for (const it of results) {
      if (it.status === "Error") {
        console.error(`Failed to execute migration "${it.migrationName}"`);
      }
    }
  }

  if (error) {
    console.error("Failed to migrate", error);
    throw error;
  }
}

export async function setupTestDatabase(): Promise<{
  container: StartedPostgreSqlContainer;
  db: Kysely<DB>;
  connectionString: string;
}> {
  if (container && db) {
    return {
      container,
      db,
      connectionString: container.getConnectionUri(),
    };
  }

  container = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("dofus_test")
    .withUsername("test")
    .withPassword("test")
    .start();

  const connectionString = container.getConnectionUri();

  const pool = new Pool({
    connectionString,
    max: 10,
  });

  db = new Kysely<DB>({
    dialect: new PostgresDialect({ pool }),
    plugins: [new CamelCasePlugin({ maintainNestedObjectKeys: true })],
  });

  await runMigrations(db);

  return { container, db, connectionString };
}

export async function teardownTestDatabase(): Promise<void> {
  if (db) {
    await db.destroy();
    db = null;
  }
  if (container) {
    await container.stop();
    container = null;
  }
}

export function createTestDatabaseModule(testDb: Kysely<DB>) {
  @Global()
  @Module({
    providers: [{ provide: DATABASE, useValue: testDb }],
    exports: [DATABASE],
  })
  class TestKyselyModule {}

  @Global()
  @Module({
    imports: [
      TestKyselyModule,
      ClsModule.forRoot({
        plugins: [
          new ClsPluginTransactional({
            imports: [TestKyselyModule],
            adapter: new TransactionalAdapterKysely({
              kyselyInstanceToken: DATABASE,
            }),
          }),
        ],
      }),
    ],
  })
  class TestDatabaseModule {}

  return TestDatabaseModule;
}
