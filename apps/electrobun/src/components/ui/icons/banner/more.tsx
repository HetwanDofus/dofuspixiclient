"use client";

import { useId } from "react";

export default function MoreIcon({ className }: { className?: string }) {
  const id0 = useId();

  return (
    <svg
      overflow="visible"
      viewBox="0 0 12.9 13.05"
      xmlns="http://www.w3.org/2000/svg"
      xmlnsXlink="http://www.w3.org/1999/xlink"
      width="12.9px"
      height="13.05px"
      className={className}
      shapeRendering="geometricPrecision"
      imageRendering="optimizeQuality"
    >
      <title>More</title>
      <g transform="matrix(1, 0, 0, 1, 0.5, 0.5)">
        <use
          xlinkHref={`#${id0}`}
          width="12.9"
          height="13.05"
          transform="matrix(1, 0, 0, 1, -0.5, -0.5)"
        />
      </g>
      <defs>
        <g transform="matrix(1, 0, 0, 1, 0.5, 0.5)" id={id0}>
          <path
            fillRule="evenodd"
            fill="#63391d"
            stroke="none"
            d="M11.9 6.1L11.6 7.2L7.2 7.2L7.2 11.6Q6.65 12.05 6.05 12.05L4.75 11.6L4.75 7.2L0.4 7.2Q0.05 6.65 0 6.15Q-0.05 5.45 0.4 4.75L4.75 4.75L4.75 0.35Q5.4 0 6 0Q6.65 0 7.2 0.35L7.2 4.75L11.6 4.75Q11.95 5.45 11.9 6.1"
          />
          <path
            fill="none"
            stroke="#63391d"
            strokeWidth="1"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M11.9 6.1L11.6 7.2L7.2 7.2L7.2 11.6Q6.65 12.05 6.05 12.05L4.75 11.6L4.75 7.2L0.4 7.2Q0.05 6.65 0 6.15Q-0.05 5.45 0.4 4.75L4.75 4.75L4.75 0.35Q5.4 0 6 0Q6.65 0 7.2 0.35L7.2 4.75L11.6 4.75Q11.95 5.45 11.9 6.1"
          />
          <path
            fillRule="evenodd"
            fill="#ffcc00"
            stroke="none"
            d="M7.2 4.75L11.6 4.75Q11.95 5.45 11.9 6.1L6.05 6.15L7.2 4.75M6.05 12.05L4.75 11.6L4.75 7.2L6.05 6.15L6 0Q5.4 0 4.75 0.35L4.75 4.75L0.4 4.75Q-0.05 5.45 0 6.15L6.05 6.15L6.05 12.05"
          />
          <path
            fillRule="evenodd"
            fill="#d37f00"
            stroke="none"
            d="M11.9 6.1L11.6 7.2L7.2 7.2L7.2 11.6Q6.65 12.05 6.05 12.05L6.05 6.15L11.9 6.1M4.75 7.2L0.4 7.2Q0.05 6.65 0 6.15L6.05 6.15L4.75 7.2"
          />
          <path
            fillRule="evenodd"
            fill="#e9dca7"
            stroke="none"
            d="M6 0Q6.65 0 7.2 0.35L7.2 4.75L6.05 6.15L6 0"
          />
          <path
            fill="none"
            stroke="#000000"
            strokeOpacity="0.29803921568627"
            strokeWidth="var(--ns-stroke, 1)"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M7.2 4.75L11.6 4.75Q11.95 5.45 11.9 6.1L11.6 7.2L7.2 7.2L7.2 11.6Q6.65 12.05 6.05 12.05L4.75 11.6L4.75 7.2L0.4 7.2Q0.05 6.65 0 6.15Q-0.05 5.45 0.4 4.75L4.75 4.75L4.75 0.35Q5.4 0 6 0Q6.65 0 7.2 0.35L7.2 4.75"
          />
        </g>
      </defs>
    </svg>
  );
}
