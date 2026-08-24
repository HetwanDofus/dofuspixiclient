import { useEffect, useRef, useState } from "react";

import { INVENTORY_COLORS } from "./inventory-theme";

const C = INVENTORY_COLORS;

interface TypeSelectProps {
  /** `null` renders as "Tous types". */
  value: string | null;
  options: string[];
  onChange: (value: string | null) => void;
  zoom: number;
}

/**
 * The "Tous types" combo — same hand-rolled dropdown as
 * `SpellTypeSelect`, generalised to an arbitrary string list since the
 * bag's type options depend on what the player is actually carrying
 * (there is no fixed catalogue to hardcode against).
 */
export function TypeSelect({
  value,
  options,
  onChange,
  zoom,
}: TypeSelectProps) {
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
          border: "none",
          borderRadius: p(4),
          padding: `0 ${p(5)}px`,
          fontFamily: "Verdana, sans-serif",
          fontSize: p(8),
          color: C.text,
          cursor: "pointer",
          boxSizing: "border-box",
        }}
      >
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {value ?? "Tous types"}
        </span>
        <svg
          width={p(8)}
          height={p(5)}
          viewBox="0 0 10 6"
          aria-hidden="true"
          style={{ flexShrink: 0, marginLeft: p(3) }}
        >
          <path d="M0 0h10L5 6z" fill="#2b2b2b" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Type d'objet"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: "100%",
            margin: 0,
            padding: 0,
            background: "#ffffff",
            border: `1px solid ${C.header}`,
            borderRadius: p(3),
            zIndex: 5,
            maxHeight: p(150),
            overflowY: "auto",
          }}
        >
          <button
            type="button"
            role="option"
            aria-selected={value === null}
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              border: "none",
              background: value === null ? "#e7e1c4" : "transparent",
              padding: `${p(3)}px ${p(5)}px`,
              fontFamily: "Verdana, sans-serif",
              fontSize: p(8),
              color: C.text,
              cursor: "pointer",
            }}
          >
            Tous types
          </button>
          {options.map((option) => (
            <button
              key={option}
              type="button"
              role="option"
              aria-selected={option === value}
              onClick={() => {
                onChange(option);
                setOpen(false);
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                border: "none",
                background: option === value ? "#e7e1c4" : "transparent",
                padding: `${p(3)}px ${p(5)}px`,
                fontFamily: "Verdana, sans-serif",
                fontSize: p(8),
                color: C.text,
                cursor: "pointer",
              }}
            >
              {option}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
