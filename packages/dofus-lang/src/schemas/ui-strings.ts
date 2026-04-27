/**
 * Schema for flat-global UI-string namespaces (lang, hints, kb, shortcuts,
 * emotes, ranks, audio, ttg, fightChallenge, ...). Each SWF dumps a flat set
 * of `CONSTANT_NAME = "value"` assignments plus a FILE_BEGIN / VERSION /
 * FILE_END envelope.
 *
 * Values are almost always plain strings with `%1 %2` placeholders or HTML
 * markup (`<b>…</b>`, `<u>…</u>`, `<a href=…>`).
 */

import { z } from "zod";

/**
 * Lang files are mostly flat `CONSTANT_NAME = "template"` entries but also
 * carry a handful of nested config trees (`C` → URLs, `CNS` → keybindings,
 * `COM`/`CSR` → community/customer-support constants). The catchall allows
 * any value type; the normalizer splits top-level strings into `strings`
 * and keeps the nested config under `config`.
 */
export const RawUiStringsBundleSchema = z
  .object({
    FILE_BEGIN: z.boolean().optional(),
    VERSION: z.number().optional(),
    FILE_END: z.boolean().optional(),
  })
  .catchall(z.unknown());
export type RawUiStringsBundle = z.infer<typeof RawUiStringsBundleSchema>;

export interface UiStringsBundle {
  version?: number | undefined;
  /** CONSTANT_NAME → template string. Only top-level string values. */
  strings: Map<string, string>;
  /** Nested config trees (C → URLs, CNS → keybindings, COM, CSR, …). */
  config: Map<string, unknown>;
}

const ENVELOPE_KEYS = new Set(["FILE_BEGIN", "VERSION", "FILE_END"]);

export function normalizeUiStringsBundle(data: unknown): UiStringsBundle | null {
  const parsed = RawUiStringsBundleSchema.safeParse(data);
  if (!parsed.success) return null;
  const strings = new Map<string, string>();
  const config = new Map<string, unknown>();
  for (const [k, v] of Object.entries(parsed.data)) {
    if (ENVELOPE_KEYS.has(k)) continue;
    if (typeof v === "string") {
      strings.set(k, v);
    } else if (v !== null && typeof v === "object") {
      config.set(k, v);
    }
  }
  return {
    version: typeof parsed.data.VERSION === "number" ? parsed.data.VERSION : undefined,
    strings,
    config,
  };
}
