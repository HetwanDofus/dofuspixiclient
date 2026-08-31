/**
 * True in a Vite dev build (`vite dev` / `just client-web`), false in any
 * production bundle.
 *
 * Read through a cast rather than `vite/client` types because the same `src/`
 * is also bundled for the Electrobun desktop shell, where `import.meta.env`
 * may not exist at all — the optional chain makes that case plainly `false`
 * instead of a runtime throw.
 */
const env = (import.meta as { env?: { DEV?: boolean } }).env;

export const IS_DEV_BUILD = env?.DEV === true;
