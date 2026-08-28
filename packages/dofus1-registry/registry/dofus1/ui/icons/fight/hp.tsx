"use client";

export function HP({ className }: { className?: string }) {
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
      <title>Hit points</title>
      <path
        d="M8 14 Q2 10 2 6 Q2 3 5 3 Q7 3 8 5 Q9 3 11 3 Q14 3 14 6 Q14 10 8 14 Z"
        fill="var(--color-dofus-hp-red, #c81414)"
        stroke="#ffffff"
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  );
}
