import { useEffect, useRef, useState } from "react";

import { SPELL_BOOK_COLORS } from "./spell-book-theme";

const C = SPELL_BOOK_COLORS;

export type SpellTypeFilter = "class" | "all";

const OPTIONS: { value: SpellTypeFilter; label: string }[] = [
  { value: "class", label: "Classe" },
  { value: "all", label: "Tous" },
];

interface SpellTypeSelectProps {
  value: SpellTypeFilter;
  onChange: (value: SpellTypeFilter) => void;
  zoom: number;
}

/**
 * The "Type de sort" combo — a white rounded field with a solid caret,
 * as in the 1.29 window. Hand-rolled rather than a native `<select>`:
 * the native control renders with the OS chrome, which is exactly what
 * the rest of this HUD avoids.
 */
export function SpellTypeSelect({
  value,
  onChange,
  zoom,
}: SpellTypeSelectProps) {
  const p = (n: number) => n * zoom;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  const current = OPTIONS.find((o) => o.value === value) ?? OPTIONS[0];

  return (
    <div ref={rootRef} style={{ position: "relative", height: "100%" }}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "#ffffff",
          border: `${Math.max(1, p(1))}px solid #ffffff`,
          borderRadius: p(4),
          padding: `0 ${p(5)}px`,
          fontFamily: "Verdana, sans-serif",
          fontSize: p(9),
          color: C.text,
          cursor: "pointer",
          boxSizing: "border-box",
        }}
      >
        <span>{current.label}</span>
        <svg
          width={p(8)}
          height={p(5)}
          viewBox="0 0 10 6"
          aria-hidden="true"
          style={{ flexShrink: 0 }}
        >
          <path d="M0 0h10L5 6z" fill="#2b2b2b" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Type de sort"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: "100%",
            margin: 0,
            padding: 0,
            background: "#ffffff",
            border: `${Math.max(1, p(1))}px solid ${C.header}`,
            borderRadius: p(3),
            zIndex: 5,
            overflow: "hidden",
          }}
        >
          {OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                border: "none",
                background:
                  option.value === value ? C.rowSelected : "transparent",
                padding: `${p(3)}px ${p(5)}px`,
                fontFamily: "Verdana, sans-serif",
                fontSize: p(9),
                color: C.text,
                cursor: "pointer",
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
