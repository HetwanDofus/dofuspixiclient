import { CamelCasePlugin } from "kysely";
import { defineConfig } from "kysely-ctl";
import pg from "pg";

const connectionString =
  process.env.DATABASE_URL ??
  "postgres://postgres:postgres@localhost:5432/dofus";

export default defineConfig({
  dialect: "pg",
  dialectConfig: {
    pool: new pg.Pool({ connectionString }),
  },
  plugins: [new CamelCasePlugin()],
  migrations: {
    migrationFolder: "migrations",
  },
});
