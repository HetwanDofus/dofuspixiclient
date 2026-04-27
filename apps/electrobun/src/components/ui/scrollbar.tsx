"use client";

import type * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

const ARROW_PATHS = {
  up: "M6 4 L8.5 8 L3.5 8 Z",
  down: "M6 8 L8.5 4 L3.5 4 Z",
  left: "M4 6 L8 3.5 L8 8.5 Z",
  right: "M8 6 L4 3.5 L4 8.5 Z",
} as const;

type ArrowDirection = keyof typeof ARROW_PATHS;

function ScrollbarArrow({
  direction,
  onClick,
}: {
  direction: ArrowDirection;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Scroll ${direction}`}
      className={cn(
        "block shrink-0 cursor-pointer border-none p-0",
        "w-[calc(12px*var(--resolution-factor))]",
        "h-[calc(12px*var(--resolution-factor))]"
      )}
    >
      <svg
        viewBox="0 0 12 12"
        className="w-full h-full"
        fill="#514a3c"
        shapeRendering="geometricPrecision"
        role="img"
      >
        <title>{`Scroll ${direction}`}</title>
        <path d={ARROW_PATHS[direction]} />
      </svg>
    </button>
  );
}

const scrollbarVariants = cva("flex bg-[#beb998]", {
  variants: {
    axis: {
      vertical: "flex-col w-[calc(12px*var(--resolution-factor))]",
      horizontal: "flex-row h-[calc(12px*var(--resolution-factor))]",
    },
  },
  defaultVariants: { axis: "vertical" },
});

interface ScrollbarProps extends VariantProps<typeof scrollbarVariants> {
  className?: string;
  /**
   * Ref to the scrollable element this scrollbar controls. When provided,
   * the scrollbar renders a dynamic thumb that tracks the target's scroll
   * position, reacts to arrow clicks, and can be dragged to set scrollTop.
   * When absent, the scrollbar stays purely decorative (static full-track
   * fill) — unchanged behavior for existing consumers.
   */
  scrollTarget?: React.RefObject<HTMLElement | null>;
  /** Pixels to move per arrow button click. Defaults to 30. */
  arrowStep?: number;
}

function Scrollbar({
  axis = "vertical",
  className,
  scrollTarget,
  arrowStep = 30,
}: ScrollbarProps) {
  const isVertical = axis === "vertical";
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState({
    size: 1,
    position: 0,
    scrollable: false,
  });

  // Sync thumb metrics with the target's scroll state. Watches scroll,
  // resize, and child mutations so the thumb stays accurate as content
  // grows (e.g. new chat messages appending).
  useEffect(() => {
    if (!scrollTarget) {
      return;
    }

    const el = scrollTarget.current;

    if (!el) {
      return;
    }

    const sync = () => {
      const scrollLen = isVertical ? el.scrollHeight : el.scrollWidth;
      const clientLen = isVertical ? el.clientHeight : el.clientWidth;
      const scrollPos = isVertical ? el.scrollTop : el.scrollLeft;
      const range = scrollLen - clientLen;

      if (range <= 0) {
        setState({ size: 1, position: 0, scrollable: false });

        return;
      }

      setState({
        size: clientLen / scrollLen,
        position: scrollPos / range,
        scrollable: true,
      });
    };

    sync();

    el.addEventListener("scroll", sync, { passive: true });

    const resizeObs = new ResizeObserver(sync);
    resizeObs.observe(el);

    const mutObs = new MutationObserver(sync);
    mutObs.observe(el, { childList: true, subtree: true });

    return () => {
      el.removeEventListener("scroll", sync);
      resizeObs.disconnect();
      mutObs.disconnect();
    };
  }, [scrollTarget, isVertical]);

  const scrollBy = useCallback(
    (delta: number) => {
      const el = scrollTarget?.current;

      if (!el) {
        return;
      }

      if (isVertical) {
        el.scrollTop += delta;
      } else {
        el.scrollLeft += delta;
      }
    },
    [scrollTarget, isVertical]
  );

  // Thumb drag — bound as an onMouseDown prop (not via addEventListener in
  // an effect) so the handler always attaches to whichever thumb element is
  // mounted. The initial render shows the static thumb while `scrollable`
  // is still false, and the dynamic thumb only mounts once the sync effect
  // flips `scrollable` to true — so an effect-based listener attached on
  // mount would miss the actual draggable node.
  const handleThumbMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!scrollTarget) {
        return;
      }

      const thumb = thumbRef.current;
      const track = trackRef.current;
      const el = scrollTarget.current;

      if (!thumb || !track || !el) {
        return;
      }

      e.preventDefault();

      const trackRect = track.getBoundingClientRect();
      const thumbRect = thumb.getBoundingClientRect();
      const trackLen = isVertical ? trackRect.height : trackRect.width;
      const thumbLen = isVertical ? thumbRect.height : thumbRect.width;
      const usable = Math.max(1, trackLen - thumbLen);
      const startMouse = isVertical ? e.clientY : e.clientX;
      const startOffset = isVertical
        ? thumbRect.top - trackRect.top
        : thumbRect.left - trackRect.left;

      const handleMouseMove = (ev: MouseEvent) => {
        const curMouse = isVertical ? ev.clientY : ev.clientX;
        const delta = curMouse - startMouse;
        const nextOffset = Math.max(0, Math.min(usable, startOffset + delta));
        const fraction = nextOffset / usable;
        const scrollLen = isVertical ? el.scrollHeight : el.scrollWidth;
        const clientLen = isVertical ? el.clientHeight : el.clientWidth;
        const range = scrollLen - clientLen;

        if (range <= 0) {
          return;
        }

        if (isVertical) {
          el.scrollTop = fraction * range;
        } else {
          el.scrollLeft = fraction * range;
        }
      };

      const handleMouseUp = () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [scrollTarget, isVertical]
  );

  // Hide entirely when attached to a target whose content fits. Purely
  // decorative usages (no `scrollTarget`) always render — preserves the
  // main banner's existing "scrollbar as pure chrome" usage.
  if (scrollTarget && !state.scrollable) {
    return null;
  }

  // `scrollTarget` being set implies `state.scrollable` at this point
  // (otherwise we returned above).
  const isControlled = scrollTarget != null;
  // Minimum 5 % keeps the thumb grabbable when content is very long.
  const thumbSizePct = Math.max(5, Math.min(100, state.size * 100));
  const thumbStartPct = state.position * (100 - thumbSizePct);

  // Matches the chamfered "I-beam" look used by both static and dynamic
  // thumbs: a 1 px inset from the track on the non-scroll axis plus a
  // 1 px × 1 px cap at each end with an extra 1 px transverse margin.
  const axisInsetClass = isVertical
    ? "left-[calc(1px*var(--resolution-factor))] right-[calc(1px*var(--resolution-factor))]"
    : "top-[calc(1px*var(--resolution-factor))] bottom-[calc(1px*var(--resolution-factor))]";
  const capClass = cn(
    "bg-[#514a3c]",
    isVertical
      ? "h-[calc(1px*var(--resolution-factor))] mx-[calc(1px*var(--resolution-factor))]"
      : "w-[calc(1px*var(--resolution-factor))] my-[calc(1px*var(--resolution-factor))]"
  );

  return (
    <div className={cn(scrollbarVariants({ axis }), className)}>
      <ScrollbarArrow
        direction={isVertical ? "up" : "left"}
        onClick={isControlled ? () => scrollBy(-arrowStep) : undefined}
      />
      <div ref={trackRef} className="relative flex-1">
        {isControlled ? (
          <div
            ref={thumbRef}
            onMouseDown={handleThumbMouseDown}
            role="slider"
            aria-orientation={isVertical ? "vertical" : "horizontal"}
            aria-valuemin={0}
            aria-valuemax={1}
            aria-valuenow={state.position}
            tabIndex={-1}
            className={cn(
              "absolute flex cursor-pointer select-none",
              isVertical ? "flex-col" : "flex-row",
              axisInsetClass
            )}
            style={
              isVertical
                ? { top: `${thumbStartPct}%`, height: `${thumbSizePct}%` }
                : { left: `${thumbStartPct}%`, width: `${thumbSizePct}%` }
            }
          >
            <div className={capClass} />
            <div className="flex-1 bg-[#514a3c]" />
            <div className={capClass} />
          </div>
        ) : (
          <div
            className={cn(
              "absolute flex",
              isVertical
                ? ["inset-y-0 flex-col", axisInsetClass]
                : ["inset-x-0 flex-row", axisInsetClass]
            )}
          >
            <div className={capClass} />
            <div className="flex-1 bg-[#514a3c]" />
            <div className={capClass} />
          </div>
        )}
      </div>
      <ScrollbarArrow
        direction={isVertical ? "down" : "right"}
        onClick={isControlled ? () => scrollBy(arrowStep) : undefined}
      />
    </div>
  );
}

export type { ScrollbarProps };
export { Scrollbar };
