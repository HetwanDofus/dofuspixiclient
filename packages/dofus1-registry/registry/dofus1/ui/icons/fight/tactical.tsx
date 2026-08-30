"use client";

export function Tactical({ className }: { className?: string }) {
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
      <title>Tactical mode</title>
      <g transform="translate(12 12)">
        {/* Isometric diamond grid — 3x3 tiles */}
        <g stroke="#ffffff" strokeWidth="1" fill="none" strokeLinejoin="round">
          <path d="M-10 0 L0 -5 L10 0 L0 5 Z" />
          <path d="M-7 -1.5 L-3 -3.5 M3 -3.5 L7 -1.5 M-7 1.5 L-3 3.5 M3 3.5 L7 1.5" />
          <path d="M-5 -2.5 L-5 2.5 M0 -5 L0 5 M5 -2.5 L5 2.5" />
        </g>
        <g stroke="#ffffff" strokeWidth="0.75" fill="none" strokeDasharray="1,1">
          <path d="M-8 -3 L8 -3 M-8 3 L8 3" />
        </g>
      </g>
    </svg>
  );
}
