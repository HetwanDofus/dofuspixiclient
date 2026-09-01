import { useEffect, useState, useSyncExternalStore } from "react";

import { jobsStore } from "@/game/stores/jobs-store";

/** How often the bar redraws. 1.29's own gauge is not smoother than this. */
const TICK_MS = 60;

/**
 * The gauge over a character who is gathering.
 *
 * Until it existed, a harvest was **invisible**: the server sent `GA;501`
 * with its duration, the store recorded it, and nothing on screen said the
 * character was busy. A player clicked "Couper", watched their character
 * stand still, and reasonably concluded nothing had happened — the wood
 * arrived twelve seconds later without a word.
 *
 * The duration is the server's, counted down here and never recomputed: a
 * client that shortened it would only be lying to its own player.
 *
 * The anchor is captured once, when the action starts, and does not follow
 * the camera — the same limitation the nameplates have, and harmless here
 * because a character that moves has its harvest interrupted.
 */
export function HarvestGauge() {
  const { harvesting } = useSyncExternalStore(
    jobsStore.subscribe,
    jobsStore.getSnapshot
  );
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!harvesting) {
      return;
    }

    const timer = setInterval(() => setTick((n) => n + 1), TICK_MS);

    return () => clearInterval(timer);
  }, [harvesting]);

  if (!harvesting) {
    return null;
  }

  const elapsed = Date.now() - harvesting.startedAt;
  const ratio = Math.min(1, Math.max(0, elapsed / harvesting.durationMs));
  const remaining = Math.max(0, harvesting.durationMs - elapsed);

  return (
    <div
      role="presentation"
      style={{
        position: "absolute",
        left: harvesting.anchorX,
        top: harvesting.anchorY,
        transform: "translate(-50%, -100%)",
        pointerEvents: "none",
        userSelect: "none",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 2,
      }}
    >
      <div
        style={{
          fontFamily: "DofusVerdana, Verdana, sans-serif",
          fontWeight: "bold",
          fontSize: "calc(10px * var(--resolution-factor, 1))",
          color: "#fff",
          textShadow: "0 1px 2px rgba(0,0,0,.9)",
        }}
      >
        {(remaining / 1000).toFixed(1)}s
      </div>

      <div
        style={{
          width: "calc(46px * var(--resolution-factor, 1))",
          height: "calc(6px * var(--resolution-factor, 1))",
          background: "rgba(0, 0, 0, .7)",
          border: "1px solid rgba(0, 0, 0, .9)",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${ratio * 100}%`,
            height: "100%",
            background: "#8fae4a",
            transition: `width ${TICK_MS}ms linear`,
          }}
        />
      </div>
    </div>
  );
}
