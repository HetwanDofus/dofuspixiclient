"use client";

import { useRef, useSyncExternalStore } from "react";

import type { PerfSceneSample } from "@/game/stores";
import { perfStore } from "@/game/stores";
import { cn } from "@/lib/utils";

/**
 * Dev-only performance panel, rendered in the letterbox gutter beside the
 * canvas — never over it, so it cannot cost the game a pixel or a click.
 *
 * It replaces the green `position:fixed` FPS overlay the engine used to paint
 * on top of the play area. Same numbers, read from `perfStore` at the 1 Hz
 * cadence the engine already sampled at: no per-frame React work, no extra
 * measurement. The panel simply does not mount when the build isn't a dev
 * build or the gutter is too narrow (see `MIN_GUTTER_WIDTH`), so a normal
 * player never pays for it.
 */

/** Below this the gutter is too tight to read — the panel stays away. */
export const MIN_GUTTER_WIDTH = 232;
/** A short gutter (very wide, very flat window) can't hold the card either. */
export const MIN_GUTTER_HEIGHT = 300;

const SPARK_SAMPLES = 48;
/**
 * The connection badge (`.connection-indicator`) is pinned top-right of the
 * same box, so the card starts below it rather than under it.
 */
const TOP_INSET = 44;

export interface AdminPanelProps {
  /** The gutter to draw in, in `.map-renderer`-relative px. */
  gutter: { left: number; top: number; width: number; height: number };
}

export function AdminPanel({ gutter }: AdminPanelProps) {
  const { fps, sampledAt, scene } = useSyncExternalStore(
    perfStore.subscribe,
    perfStore.getSnapshot
  );

  // 48 s of FPS history, appended once per sample. A ref, not state: the
  // store update already re-renders us, and the history must survive a
  // re-render caused by a resize without growing an extra entry.
  const history = useRef<number[]>([]);
  const lastSample = useRef(0);

  if (sampledAt !== lastSample.current) {
    lastSample.current = sampledAt;
    history.current = [...history.current, fps].slice(-SPARK_SAMPLES);
  }

  return (
    <div
      className={cn(
        "pointer-events-none absolute flex flex-col gap-3 overflow-hidden",
        "rounded-lg border border-white/10 bg-black/40 p-3",
        "font-mono text-[11px] text-neutral-300 select-none"
      )}
      style={{
        left: gutter.left + 12,
        top: gutter.top + TOP_INSET,
        width: gutter.width - 24,
        maxHeight: gutter.height - TOP_INSET - 12,
      }}
    >
      <header className="flex items-baseline justify-between">
        <span className="font-sans text-[10px] font-semibold tracking-[0.18em] text-neutral-500 uppercase">
          Admin
        </span>
        <span className="text-[10px] text-neutral-600">dev build</span>
      </header>

      <FpsBlock fps={fps} history={history.current} />

      {scene ? (
        <SceneBlocks scene={scene} />
      ) : (
        <p className="text-[10px] text-neutral-600">Scène en attente…</p>
      )}
    </div>
  );
}

function fpsTone(fps: number): string {
  if (fps >= 55) {
    return "text-emerald-400";
  }

  if (fps >= 30) {
    return "text-amber-400";
  }

  return "text-red-400";
}

function FpsBlock({ fps, history }: { fps: number; history: number[] }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <span
          className={cn(
            "font-sans text-3xl leading-none font-semibold tabular-nums",
            fpsTone(fps)
          )}
        >
          {fps}
        </span>
        <span className="text-[10px] tracking-wider text-neutral-500 uppercase">
          fps
        </span>
      </div>
      <Sparkline values={history} />
    </section>
  );
}

/**
 * 48 one-second samples as bars, scaled against 60 fps so the shape reads as
 * "how far below the target" rather than auto-scaling to the noise.
 */
function Sparkline({ values }: { values: number[] }) {
  return (
    <div className="flex h-8 items-end gap-px" aria-hidden="true">
      {Array.from({ length: SPARK_SAMPLES }, (_, i) => {
        const offset = values.length - SPARK_SAMPLES + i;
        const value = offset >= 0 ? values[offset] : undefined;
        const height =
          value === undefined
            ? 0
            : Math.max(2, Math.min(100, (value / 60) * 100));

        return (
          <div
            key={i}
            className={cn(
              "flex-1 rounded-[1px]",
              value === undefined ? "bg-white/5" : "bg-emerald-400/60"
            )}
            style={{ height: `${value === undefined ? 100 : height}%` }}
          />
        );
      })}
    </div>
  );
}

function SceneBlocks({ scene }: { scene: PerfSceneSample }) {
  const slotRatio =
    scene.atlasMaxSlots > 0 ? scene.atlasSlots / scene.atlasMaxSlots : 0;

  return (
    <>
      <section className="flex flex-col gap-1.5">
        <SectionTitle>Scène</SectionTitle>
        <Row label="Acteurs" value={String(scene.actors)} />
        <Row
          label="Update"
          value={`${scene.updateMs.toFixed(1)} ms`}
          tone={scene.updateMs > 8 ? "warn" : "ok"}
        />
      </section>

      <section className="flex flex-col gap-1.5">
        <SectionTitle>Atlas Vello</SectionTitle>
        <Meter ratio={slotRatio} />
        <Row
          label="Slots"
          value={`${scene.atlasSlots} / ${scene.atlasMaxSlots}`}
        />
        <Row
          label="Rendus"
          value={String(scene.renders)}
          // Steady-state is 0: every frame served from the atlas. A number
          // that stays high means slots are being evicted and re-rasterised.
          tone={scene.renders > 20 ? "warn" : "ok"}
        />
        <Row label="Hits" value={String(scene.hits)} />
        <Row label="Queue" value={`${scene.queueMs.toFixed(1)} ms`} />
        <Row label="Flush" value={`${scene.flushMs.toFixed(1)} ms`} />
      </section>
    </>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-sans text-[10px] font-semibold tracking-[0.14em] text-neutral-500 uppercase">
      {children}
    </h2>
  );
}

function Row({
  label,
  value,
  tone = "ok",
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn";
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-neutral-500">{label}</span>
      <span
        className={cn(
          "tabular-nums",
          tone === "warn" ? "text-amber-400" : "text-neutral-200"
        )}
      >
        {value}
      </span>
    </div>
  );
}

function Meter({ ratio }: { ratio: number }) {
  const pct = Math.max(0, Math.min(1, ratio)) * 100;

  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-500",
          pct > 90 ? "bg-amber-400" : "bg-sky-400/80"
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
