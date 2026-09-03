import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { harvestSoundsFor } from "@/game/audio/harvest-sounds";

/**
 * Guards the harvest sounds against the shipped bundles rather than a
 * fixture — the QA-147 failure mode was a chain that every injected stub
 * satisfied and the real files did not.
 *
 * Two links are asserted: the name a job's sound is written with must resolve
 * to a published mp3, and the resource must name a job at all (the client
 * reads it off `SK[skill].j`, through the gfx standing on the cell).
 */

const ASSETS_ROOT = resolve(import.meta.dir, "../../../public/assets");
const LANGS = join(ASSETS_ROOT, "langs", "fr");

function bundle(name: string): Record<string, unknown> {
  const json = JSON.parse(readFileSync(join(LANGS, `${name}.json`), "utf-8"));
  return json.data as Record<string, unknown>;
}

const audio = bundle("audio");
const AUEC = audio.AUEC as Record<string, number>;
const AUE = audio.AUE as Record<string, { f: string }>;

const skills = bundle("skills").SK as Record<string, { j?: number }>;
const io = bundle("interactiveobjects").IO as {
  g: Record<string, number>;
  d: Record<string, { sk?: number[] }>;
};

/** Frêne — the tree the harvest flow was built against. */
const ASH_TREE_GFX = 7500;
const LUMBERJACK = 2;

/** Every job the sound table answers for. */
const JOBS = [2, 24, 26, 28, 36];

describe("harvest sounds", () => {
  it("names effects the shipped bundle can resolve to a file", () => {
    for (const jobId of JOBS) {
      const sounds = harvestSoundsFor(jobId);
      expect(sounds).not.toBeNull();

      for (const name of [sounds?.work, sounds?.done]) {
        const keyname = String(name).toUpperCase();
        const id = AUEC[keyname];
        // Named in the failure so a missing sound says which job's it is.
        const resolved = `${keyname} → ${AUE[String(id)]?.f ?? "nothing"}`;

        expect(resolved).toBe(`${keyname} → fx_${id}.mp3`);
      }
    }
  });

  it("reads a tree's job the way the client does", () => {
    const entryId = io.g[String(ASH_TREE_GFX)];
    const skillIds = io.d[String(entryId)]?.sk ?? [];
    const jobIds = skillIds.map((id) => skills[String(id)]?.j ?? 0);

    expect(jobIds).toContain(LUMBERJACK);
    expect(harvestSoundsFor(LUMBERJACK)?.work).toBe("hache_2m");
  });
});
