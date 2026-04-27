import type { DB } from "@shared/db/schema";
import { CamelCasePlugin, Kysely, PostgresDialect } from "kysely";
import pg from "pg";

export type Database = Kysely<DB>;

export function createDatabase(connectionString: string): Database {
  return new Kysely<DB>({
    dialect: new PostgresDialect({
      pool: new pg.Pool({ connectionString }),
    }),
    plugins: [new CamelCasePlugin()],
  });
}
