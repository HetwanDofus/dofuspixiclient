"use client";

import { useId } from "react";

export default function LessIcon({ className }: { className?: string }) {
  const id0 = useId();

  return (
    <svg
      overflow="visible"
      viewBox="0 0 12.9 3.45"
      xmlns="http://www.w3.org/2000/svg"
      xmlnsXlink="http://www.w3.org/1999/xlink"
      width="12.9px"
      height="3.45px"
      className={className}
      shapeRendering="geometricPrecision"
      imageRendering="optimizeQuality"
    >
      <title>Less</title>
      <g transform="matrix(1, 0, 0, 1, 0.5, 0.5)">
        <use
          xlinkHref={`#${id0}`}
          width="12.9"
          height="3.45"
          transform="matrix(1, 0, 0, 1, -0.5, -0.5)"
        />
      </g>
      <defs>
        <g transform="matrix(1, 0, 0, 1, 0.5, 0.5)" id={id0}>
          <path
            fillRule="evenodd"
            fill="#63391d"
            stroke="none"
            d="M0 1.35Q-0.05 0.7 0.35 0L11.6 0Q11.95 0.65 11.9 1.35L11.6 2.45L0.35 2.45L0 1.35"
          />
          <path
            fill="none"
            stroke="#63391d"
            strokeWidth="1"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M0 1.35Q-0.05 0.7 0.35 0L11.6 0Q11.95 0.65 11.9 1.35L11.6 2.45L0.35 2.45L0 1.35"
          />
          <path
            fillRule="evenodd"
            fill="#ffcc00"
            stroke="none"
            d="M0 1.4Q-0.05 0.75 0.35 0.05L11.6 0.05Q11.95 0.7 11.9 1.4L0 1.4"
          />
          <path
            fillRule="evenodd"
            fill="#d37f00"
            stroke="none"
            d="M11.9 1.4L11.6 2.45L0.35 2.45L0 1.4L11.9 1.4"
          />
          <path
            fill="none"
            stroke="#000000"
            strokeOpacity="0.29803921568627"
            strokeWidth="var(--ns-stroke, 1)"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M0 1.4Q-0.05 0.75 0.35 0.05L11.6 0.05Q11.95 0.7 11.9 1.4L11.6 2.45L0.35 2.45L0 1.4"
          />
        </g>
      </defs>
    </svg>
  );
}
