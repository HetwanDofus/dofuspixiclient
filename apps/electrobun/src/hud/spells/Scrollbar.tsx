import { useCallback, useEffect, useRef, useState } from "react";

import { SPELL_BOOK_COLORS } from "./spell-book-theme";

const C = SPELL_BOOK_COLORS;

interface ScrollbarProps {
  zoom: number;
  /** Track width in base units. */
  width: number;
  scrollTop: number;
  maxScroll: number;
  viewportHeight: number;
  contentHeight: number;
  /** How far one arrow click scrolls, in base units. */
  step: number;
  onScroll: (next: number) => void;
}

/**
 * The spell book's scrollbar: a dark track with a triangle button at
 * each end and a draggable thumb, matching the 1.29 window rather than
 * the host browser's native bar.
 *
 * Everything is expressed in the same base units as the list it scrolls,
 * so `scrollTop` here is directly the list's offset — no pixel/unit
 * conversion leaks out of this component.
 */
export function Scrollbar({
  zoom,
  width,
  scrollTop,
  maxScroll,
  viewportHeight,
  contentHeight,
  step,
  onScroll,
}: ScrollbarProps) {
  const p = (n: number) => n * zoom;
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const arrow = width;
  const trackHeight = viewportHeight - 2 * arrow;
  const thumbHeight = Math.max(
    width * 2,
    (viewportHeight / contentHeight) * trackHeight
  );
  const travel = trackHeight - thumbHeight;
  const thumbTop = maxScroll > 0 ? (scrollTop / maxScroll) * travel : 0;

  const clamp = useCallback(
    (next: number) => Math.max(0, Math.min(maxScroll, next)),
    [maxScroll]
  );

  // Drag listens on the window so the thumb keeps following the pointer
  // once it leaves the narrow track.
  useEffect(() => {
    if (!dragging) {
      return;
    }
    const onMove = (e: PointerEvent) => {
      const track = trackRef.current;
      if (!track || travel <= 0) {
        return;
      }
      const rect = track.getBoundingClientRect();
      // Screen pixels here, so the base-unit geometry is scaled inline
      // rather than through `p` (which would be a new function every
      // render and re-subscribe the listeners mid-drag).
      const y = e.clientY - rect.top - (thumbHeight * zoom) / 2;
      const ratio = y / (travel * zoom);
      onScroll(clamp(ratio * maxScroll));
    };
    const onUp = () => setDragging(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragging, travel, thumbHeight, maxScroll, clamp, onScroll, zoom]);

  return (
    <div
      style={{
        width: p(width),
        height: p(viewportHeight),
        display: "flex",
        flexDirection: "column",
        background: C.scrollTrack,
        flexShrink: 0,
      }}
    >
      <ArrowButton
        zoom={zoom}
        size={arrow}
        direction="up"
        onClick={() => onScroll(clamp(scrollTop - step))}
      />
      <div
        ref={trackRef}
        style={{ position: "relative", height: p(trackHeight) }}
        onPointerDown={(e) => {
          // Click on the track above/below the thumb pages the list.
          if (e.target !== e.currentTarget) {
            return;
          }
          const rect = e.currentTarget.getBoundingClientRect();
          const above = e.clientY - rect.top < p(thumbTop);
          onScroll(
            clamp(scrollTop + (above ? -viewportHeight : viewportHeight))
          );
        }}
      >
        <button
          type="button"
          aria-label="Faire défiler la liste"
          onPointerDown={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              onScroll(clamp(scrollTop + step));
            } else if (e.key === "ArrowUp") {
              onScroll(clamp(scrollTop - step));
            }
          }}
          style={{
            position: "absolute",
            left: p(1),
            right: p(1),
            top: p(thumbTop),
            height: p(thumbHeight),
            background: C.header,
            border: "none",
            padding: 0,
            cursor: "pointer",
          }}
        />
      </div>
      <ArrowButton
        zoom={zoom}
        size={arrow}
        direction="down"
        onClick={() => onScroll(clamp(scrollTop + step))}
      />
    </div>
  );
}

function ArrowButton({
  zoom,
  size,
  direction,
  onClick,
}: {
  zoom: number;
  size: number;
  direction: "up" | "down";
  onClick: () => void;
}) {
  const px = size * zoom;
  return (
    <button
      type="button"
      aria-label={
        direction === "up" ? "Défiler vers le haut" : "Défiler vers le bas"
      }
      onClick={onClick}
      style={{
        width: px,
        height: px,
        padding: 0,
        border: "none",
        background: "transparent",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <svg
        width={px * 0.6}
        height={px * 0.5}
        viewBox="0 0 10 8"
        aria-hidden="true"
      >
        <path
          d={direction === "up" ? "M5 0 10 8H0z" : "M5 8 0 0h10z"}
          fill={C.header}
        />
      </svg>
    </button>
  );
}
