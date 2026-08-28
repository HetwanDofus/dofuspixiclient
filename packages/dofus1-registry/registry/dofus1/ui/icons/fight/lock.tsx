"use client";

export function Lock({ className }: { className?: string }) {
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
      <title>Lock fight</title>
      <g transform="translate(12 12)">
        <path
          fill="none"
          stroke="#ffffff"
          strokeWidth="1.5"
          strokeLinecap="round"
          d="M-4 -1 L-4 -5 Q-4 -9 0 -9 Q4 -9 4 -5 L4 -1"
        />
        <rect x="-6" y="-1" width="12" height="9" rx="1.5" fill="#ad9e7e" stroke="#402b15" strokeWidth="1" />
        <circle cy="3" r="1.25" fill="#402b15" />
      </g>
    </svg>
  );
}
