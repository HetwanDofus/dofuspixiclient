"use client";

export function MP({ className }: { className?: string }) {
  return (
    <svg
      overflow="visible"
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
      width="16px"
      height="16px"
      className={className}
      shapeRendering="geometricPrecision"
    >
      <title>Movement points</title>
      <circle cx="8" cy="8" r="7" fill="var(--color-dofus-mp-green, #00bb00)" stroke="#ffffff" strokeWidth="1" />
      <text
        x="8"
        y="11.5"
        textAnchor="middle"
        fontFamily="sans-serif"
        fontSize="9"
        fontWeight="bold"
        fill="#ffffff"
      >
        PM
      </text>
    </svg>
  );
}
