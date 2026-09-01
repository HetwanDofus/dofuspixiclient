import { useSyncExternalStore } from "react";

import type { GameClient } from "@/game/game-client";
import { jobsLangSnapshot } from "@/game/lang/jobs-lang";
import { crafterStore } from "@/game/stores/crafter-store";
import { getJobs, JobOptionBit, jobsStore } from "@/game/stores/jobs-store";

import { Panel } from "../components/Panel";

const WINDOW = { width: 280, height: 312 } as const;

/**
 * The craftsmen's book — exchange type 14.
 *
 * A directory, not a container. It opens empty: 1.29's client picks a job
 * first and the server answers that one question with `EJ`, which is why
 * there is a job list on the left and nothing at all until one is chosen.
 *
 * The jobs offered are the reader's own. That is the retail behaviour and it
 * is also the only list the client has — `EJF` takes a job id and the client
 * has no roster of every job in the game to offer instead.
 */
export function CrafterListWindow({
  zoom,
  gameClient,
}: {
  zoom: number;
  gameClient: GameClient | null;
}) {
  const book = useSyncExternalStore(
    crafterStore.subscribe,
    crafterStore.getSnapshot
  );
  const jobsState = useSyncExternalStore(
    jobsStore.subscribe,
    jobsStore.getSnapshot
  );

  if (!book.open) {
    return null;
  }

  const p = (n: number) => Math.round(n * zoom);
  const lang = jobsLangSnapshot();
  const mine = getJobs(jobsState);

  return (
    <Panel
      title="Liste des artisans"
      width={WINDOW.width}
      height={WINDOW.height}
      zoom={zoom}
      onClose={() => gameClient?.exchangeLeave()}
      style={{ pointerEvents: "auto" }}
    >
      <div
        style={{
          display: "flex",
          height: "100%",
          fontSize: p(10),
          gap: p(6),
        }}
      >
        <div style={{ width: p(100), overflowY: "auto" }}>
          {mine.length === 0 && (
            <div style={{ opacity: 0.7, padding: p(6) }}>
              Aucun métier appris.
            </div>
          )}

          {mine.map((job) => (
            <button
              key={job.id}
              type="button"
              onClick={() => gameClient?.requestCrafters(job.id)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                border: "none",
                background: book.jobId === job.id ? "rgba(0,0,0,.25)" : "none",
                padding: `${p(3)}px ${p(5)}px`,
                fontSize: p(10),
                cursor: "pointer",
                color: "inherit",
              }}
            >
              {lang?.jobs.get(job.id)?.name ?? `Métier ${job.id}`}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: "auto" }}>
          {book.jobId === 0 && (
            <div style={{ opacity: 0.7, padding: p(6) }}>
              Choisis un métier.
            </div>
          )}

          {book.jobId !== 0 && book.crafters.length === 0 && (
            <div style={{ opacity: 0.7, padding: p(6) }}>
              Personne ne propose ses services.
            </div>
          )}

          {book.crafters.map((crafter) => (
            <div
              key={String(crafter.playerId)}
              style={{
                padding: `${p(3)}px ${p(5)}px`,
                borderBottom: "1px solid rgba(0,0,0,.2)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>{crafter.name}</span>
                <span style={{ opacity: 0.8 }}>niv. {crafter.level}</span>
              </div>
              <div style={{ fontSize: p(9), opacity: 0.75 }}>
                {/* `min_level` carries the artisan's minimum ingredient
                    count, not a character level — see `CrafterSummary`. */}
                {crafter.minLevel} ingrédients minimum
              </div>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

/** Kept exported so the panel's option bits have one definition. */
export { JobOptionBit };
