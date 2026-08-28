"use client";

export function Forfeit({ className }: { className?: string }) {
  return (
    <svg
      overflow="visible"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      width="24px"
      height="24px"
      className={className}
      shapeRendering="geometricPrecision"
    >
      <title>Forfeit</title>
      <g transform="translate(12 12)">
        <circle r="9" fill="var(--color-dofus-hp-red, #c81414)" stroke="#ffffff" strokeWidth="1" />
        <path
          stroke="#ffffff"
          strokeWidth="2"
          strokeLinecap="round"
          d="M-4 -4 L4 4 M4 -4 L-4 4"
        />
      </g>
    </svg>
  );
}
