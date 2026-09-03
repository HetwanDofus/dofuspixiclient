import type { InteractiveObjectData } from "@/game/types";
import { createLogger } from "@/utils/logger";

const log = createLogger("InteractiveObjectsLang");

const LOCALE = "fr";
const IO_BUNDLE_URL = `/assets/langs/${LOCALE}/interactiveobjects.json`;
const SKILLS_BUNDLE_URL = `/assets/langs/${LOCALE}/skills.json`;

/**
 * What a click on an interactive element offers, straight from the 1.29 lang
 * bundles — the same two tables `DofusTranslator.getInteractiveObjectDataByGfxText`
 * reads (`IO.g`: gfx → entry id, `IO.d`: entry id → name/type/skills) plus
 * `SK` for each skill's label.
 *
 * These bundles are extracted from the retail SWFs, so they are the canonical
 * French names. `public/assets/data/interactive-objects.json` describes the
 * same table in English and is not used for the menu.
 */
type IoBundle = {
  data?: {
    IO?: {
      g?: Record<string, number>;
      d?: Record<string, { n?: string; t?: number; sk?: number[] }>;
    };
  };
};

type SkillsBundle = {
  data?: { SK?: Record<string, { d?: string; j?: number }> };
};

let byGfx: Map<number, InteractiveObjectData> | null = null;
let loading: Promise<Map<number, InteractiveObjectData>> | null = null;

function parseBundles(
  ioJson: unknown,
  skillsJson: unknown
): Map<number, InteractiveObjectData> {
  const out = new Map<number, InteractiveObjectData>();
  const io = (ioJson as IoBundle).data?.IO;
  const labels = (skillsJson as SkillsBundle).data?.SK ?? {};

  if (!io?.g || !io.d) {
    return out;
  }

  for (const [gfxKey, entryId] of Object.entries(io.g)) {
    const gfxId = Number.parseInt(gfxKey, 10);
    const entry = io.d[String(entryId)];

    if (!Number.isFinite(gfxId) || !entry) {
      continue;
    }

    out.set(gfxId, {
      id: entryId,
      name: entry.n ?? "",
      type: entry.t ?? 0,
      skills: (entry.sk ?? []).map((id) => ({
        id,
        label: labels[String(id)]?.d ?? String(id),
        jobId: labels[String(id)]?.j ?? 0,
      })),
    });
  }

  return out;
}

export function loadInteractiveObjectsLang(): Promise<
  Map<number, InteractiveObjectData>
> {
  if (byGfx) {
    return Promise.resolve(byGfx);
  }

  if (!loading) {
    loading = Promise.all([
      fetch(IO_BUNDLE_URL).then((r) => r.json()),
      fetch(SKILLS_BUNDLE_URL).then((r) => r.json()),
    ])
      .then(([ioJson, skillsJson]) => {
        byGfx = parseBundles(ioJson, skillsJson);
        return byGfx;
      })
      .catch((err) => {
        log.error("failed to load interactive object bundles:", err);
        // Latch empty: no element resolves, so nothing is clickable and every
        // click falls through to a plain walk — degraded, never wedged.
        byGfx = new Map();
        return byGfx;
      });
  }

  return loading;
}
