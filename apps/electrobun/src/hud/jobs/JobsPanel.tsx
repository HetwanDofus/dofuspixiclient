import { useState, useSyncExternalStore } from "react";

import type { GameClient } from "@/game/game-client";
import type { PlayerJob } from "@/game/stores/jobs-store";
import { jobsLangSnapshot } from "@/game/lang/jobs-lang";
import { getJobs, JobOptionBit, jobsStore } from "@/game/stores/jobs-store";

import { Panel } from "../components/Panel";

interface JobsPanelProps {
  onClose: () => void;
  zoom?: number;
  gameClient?: GameClient | null;
}

/**
 * The three flags of `JobOptions`, in the order the retail tab lists them.
 *
 * Setting any of them is also what puts the artisan in the craftsmen's book
 * — 1.29 has no separate registration — which is why the panel says so
 * rather than showing a fourth, imaginary, checkbox.
 */
const OPTION_LABELS: readonly [bit: number, label: string][] = [
  [JobOptionBit.Paid, "Je fais payer"],
  [JobOptionBit.FreeOnFailure, "Gratuit si j'échoue"],
  [JobOptionBit.ClientSupplies, "Le client fournit"],
];

const WIDTH = 280;
const HEIGHT = 312;

/**
 * The Métiers window.
 *
 * Everything shown here arrives on the `J` channel: `JS` the skill lists,
 * `JX` the level and the two ends of the gauge. Nothing is computed — the
 * client does not hold the job experience curve and must not appear to, or
 * the bar and the server would drift apart the moment the table changed.
 *
 * The 1.29 window carries a per-job icon from `clips/jobs/<g>.swf`. Those
 * SWFs have never been extracted (`assets/sources/clips/` holds only
 * `sprites/`), so the row leads with the job's name until they are.
 */
export function JobsPanel({
  onClose,
  zoom = 1,
  gameClient = null,
}: JobsPanelProps) {
  const state = useSyncExternalStore(
    jobsStore.subscribe,
    jobsStore.getSnapshot
  );
  const jobs = getJobs(state);
  const lang = jobsLangSnapshot();

  const p = (n: number) => Math.round(n * zoom);
  const rowH = p(38);
  const [openOptions, setOpenOptions] = useState<number | null>(null);

  return (
    <Panel
      title="Métiers"
      width={WIDTH}
      height={HEIGHT}
      onClose={onClose}
      zoom={zoom}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          fontSize: p(11),
          overflowY: "auto",
        }}
      >
        {jobs.length === 0 && (
          <div
            style={{
              padding: p(12),
              opacity: 0.7,
              textAlign: "center",
              lineHeight: 1.5,
            }}
          >
            Aucun métier appris.
            <br />
            Un maître de métier peut t'en enseigner un.
          </div>
        )}

        {jobs.map((job) => {
          const name = lang?.jobs.get(job.id)?.name ?? `Métier ${job.id}`;
          // `xpMax === xpMin` is how the server spells "at the ceiling"; a
          // full bar is the honest reading, and it avoids dividing by zero.
          const span = job.xpMax - job.xpMin;
          const filled =
            span <= 0
              ? 1
              : Math.min(1, Math.max(0, (job.experience - job.xpMin) / span));

          return (
            <div
              key={job.id}
              style={{
                minHeight: rowH,
                padding: `${p(4)}px ${p(8)}px`,
                borderBottom: "1px solid rgba(0, 0, 0, 0.25)",
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                gap: p(3),
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>{name}</span>
                <span style={{ opacity: 0.8 }}>niveau {job.level}</span>
              </div>

              <div
                title={`${job.experience} / ${job.xpMax}`}
                style={{
                  position: "relative",
                  height: p(7),
                  background: "rgba(0, 0, 0, 0.35)",
                  border: "1px solid rgba(0, 0, 0, 0.5)",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: `${filled * 100}%`,
                    background: "#8fae4a",
                  }}
                />
              </div>
              {job.skills.some((skill) => skill.slots > 0) && (
                <JobOptions
                  zoom={zoom}
                  job={job}
                  expanded={openOptions === job.id}
                  onToggleExpanded={() =>
                    setOpenOptions(openOptions === job.id ? null : job.id)
                  }
                  onChange={(options, minSlots) =>
                    gameClient?.setJobOptions(job.id, options, minSlots)
                  }
                />
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

/**
 * One job's artisan terms.
 *
 * Collapsed by default: only a craft job has any, and most players never
 * touch them. Every change sends the whole set — `JO` carries the bitmask
 * and the minimum together, and there is no frame for one of the two.
 */
function JobOptions({
  zoom,
  job,
  expanded,
  onToggleExpanded,
  onChange,
}: {
  zoom: number;
  job: PlayerJob;
  expanded: boolean;
  onToggleExpanded: () => void;
  onChange: (options: number, minSlots: number) => void;
}) {
  const p = (n: number) => Math.round(n * zoom);

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={onToggleExpanded}
        style={{
          alignSelf: "flex-start",
          border: "none",
          background: "none",
          padding: 0,
          fontSize: p(9),
          opacity: 0.75,
          cursor: "pointer",
          color: "inherit",
        }}
      >
        Options d'artisan…
      </button>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: p(2) }}>
      {OPTION_LABELS.map(([bit, label]) => (
        <label key={bit} style={{ display: "flex", gap: p(4), fontSize: p(9) }}>
          <input
            type="checkbox"
            checked={(job.options & bit) === bit}
            onChange={() => onChange(job.options ^ bit, job.minSlots)}
          />
          {label}
        </label>
      ))}

      <label style={{ display: "flex", gap: p(4), fontSize: p(9) }}>
        Ingrédients minimum
        <input
          type="number"
          min={2}
          max={8}
          value={job.minSlots}
          onChange={(e) =>
            onChange(job.options, Number.parseInt(e.target.value, 10) || 2)
          }
          style={{ width: p(34), fontSize: p(9) }}
        />
      </label>

      <button
        type="button"
        onClick={onToggleExpanded}
        style={{
          alignSelf: "flex-start",
          border: "none",
          background: "none",
          padding: 0,
          fontSize: p(9),
          opacity: 0.75,
          cursor: "pointer",
          color: "inherit",
        }}
      >
        Replier
      </button>
    </div>
  );
}
