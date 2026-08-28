import { createLogger } from "@/utils/logger";

const log = createLogger("NpcLang");

const LOCALE = "fr";
const NPC_BUNDLE_URL = `/assets/langs/${LOCALE}/npc.json`;

/**
 * What a click on an NPC offers, straight from the 1.29 `npc` bundle.
 *
 * Canonical `NonPlayableCharacter.actions`
 * (`assets/sources/client-code/dofus/datacenter/NonPlayableCharacter.as:31-43`)
 * reads exactly these two tables: `N.d[npcId].a` is the NPC's list of action
 * ids, `N.a[actionId]` the label to show. `DofusBattlefield.onSpriteRelease`
 * (`:520-561`) then builds one popup entry per action.
 *
 * Deliberately mirrors `interactive-objects-lang.ts`: same fetch-once-and-latch
 * shape, same "latch empty on failure" policy, and the same reason for reading
 * the extracted bundle rather than `public/assets/data` — the bundle is what
 * retail shipped, so the labels are the canonical French ones.
 */
export interface NpcActionData {
  id: number;
  label: string;
}

export interface NpcLangData {
  name: string;
  actions: NpcActionData[];
}

type NpcBundle = {
  data?: {
    N?: {
      d?: Record<string, { n?: string; a?: number[] }>;
      a?: Record<string, string>;
    };
  };
};

let byTemplate: Map<number, NpcLangData> | null = null;
let loading: Promise<Map<number, NpcLangData>> | null = null;

function parseBundle(json: unknown): Map<number, NpcLangData> {
  const out = new Map<number, NpcLangData>();
  const n = (json as NpcBundle).data?.N;

  if (!n?.d) {
    return out;
  }

  const labels = n.a ?? {};

  for (const [idKey, entry] of Object.entries(n.d)) {
    const templateId = Number.parseInt(idKey, 10);

    if (!Number.isFinite(templateId)) {
      continue;
    }

    out.set(templateId, {
      name: entry.n ?? "",
      actions: (entry.a ?? []).map((id) => ({
        id,
        label: labels[String(id)] ?? String(id),
      })),
    });
  }

  return out;
}

export function loadNpcLang(): Promise<Map<number, NpcLangData>> {
  if (byTemplate) {
    return Promise.resolve(byTemplate);
  }

  if (!loading) {
    loading = fetch(NPC_BUNDLE_URL)
      .then((r) => r.json())
      .then((json) => {
        byTemplate = parseBundle(json);
        return byTemplate;
      })
      .catch((err) => {
        log.error("failed to load the npc bundle:", err);
        // Latch empty: the NPC still renders and still shows its nameplate,
        // it just has no action menu. Degraded, never wedged.
        byTemplate = new Map();
        return byTemplate;
      });
  }

  return loading;
}
