import { z } from "zod";

const baseShape = {
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url().optional(),
  NODE_ID: z.string().min(1).optional(),
};

const gameOnlyShape = {
  MODE: z.literal("game"),
  CORE_SOCK: z.string().min(1).default("/tmp/dofus-gamed.sock"),
  CORE_VERSION: z.string().min(1).default("dev"),
  GAME_SERVER_ID: z.coerce.number().int().positive().default(1),
  /**
   * Absolute path to the asset-pipeline's published langs dir, e.g.
   * `/repo/assets/dist/langs`. The server loads bundles from
   * `<LANGS_DIR>/<locale>/<namespace>.json` via `@dofus/dofus-lang`. Defaults
   * to the in-tree dist so local dev "just works"; override in containers.
   */
  LANGS_DIR: z
    .string()
    .min(1)
    .default(
      new URL("../../../../../../assets/dist/langs", import.meta.url).pathname
    ),
  /** Default locale to hydrate from. Override per-request if needed later. */
  DEFAULT_LOCALE: z.string().min(2).default("fr"),
};

const authOnlyShape = {
  MODE: z.literal("auth"),
  AUTH_SOCK: z.string().min(1).default("/tmp/dofus-authd.sock"),
};

const baseSchema = z.object(baseShape);
const gameOnlySchema = z.object(gameOnlyShape);
const authOnlySchema = z.object(authOnlyShape);

export const envSchema = z.discriminatedUnion("MODE", [
  z.object({ ...baseShape, ...gameOnlyShape }),
  z.object({ ...baseShape, ...authOnlyShape }),
]);

export type BaseEnv = z.infer<typeof baseSchema>;
export type GameEnv = BaseEnv & z.infer<typeof gameOnlySchema>;
export type AuthEnv = BaseEnv & z.infer<typeof authOnlySchema>;
export type Env = GameEnv | AuthEnv;
