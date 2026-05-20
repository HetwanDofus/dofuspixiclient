"use client";

import { useId } from "react";

export default function SpellsIcon({ className }: { className?: string }) {
  const id0 = useId();
  const id1 = useId();
  const id2 = useId();

  return (
    <svg
      overflow="visible"
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      xmlnsXlink="http://www.w3.org/1999/xlink"
      width="32px"
      height="32px"
      className={className}
      shapeRendering="geometricPrecision"
      imageRendering="optimizeQuality"
    >
      <title>Spells</title>
      <g transform="matrix(1, 0, 0, 1, 16, 16)">
        <use
          xlinkHref={`#${id0}`}
          width="22.4"
          height="19.55"
          transform="matrix(1, 0, 0, 1, -8.2, -14.75)"
        />
        <use
          xlinkHref={`#${id1}`}
          width="100"
          height="100"
          transform="matrix(0.32, 0, 0, 0.32, -16, -16)"
        />
      </g>
      <defs>
        <g transform="matrix(1, 0, 0, 1, 8.2, 14.75)" id={id0}>
          <path
            fillRule="evenodd"
            fill="#d6a700"
            stroke="none"
            d="M-3.5 -5.4L6.3 -5.45L6.3 -5.4L2.35 -2.55L1.4 -3.05L1.35 -3L-2.7 -5L-2.7 -5.05L-2.8 -5.05L-3.5 -5.4M3.65 3.55L6.35 -5.3L6.45 -5.3L7.8 -0.85L3.65 3.55M14.2 0.2L6.45 -5.45L11.15 -5.5L14.2 0.2M14.15 -11.3L6.4 -5.5L7.75 -10.15L14.15 -11.3M3.2 -14.75L6.3 -5.45L2.3 -8.3L3.2 -14.75"
          />
          <path
            fillRule="evenodd"
            fill="#ffcc00"
            stroke="none"
            d="M2.35 -2.55L6.3 -5.4L6.3 -5.45L-3.5 -5.4L2.3 -8.3L6.3 -5.45L3.2 -14.75L7.75 -10.15L6.4 -5.5L14.15 -11.3L11.15 -5.5L6.45 -5.45L14.2 0.2L7.8 -0.85L6.45 -5.3L6.35 -5.3L3.65 3.55L2.35 -2.55"
          />
          <path
            fillRule="evenodd"
            fill="#663300"
            stroke="none"
            d="M1.35 -3L1.4 -3.05L2.35 -2.55L2.45 -1.85L-6.7 4.7L-7 4.8L-7.25 4.6L-8.15 3.25L-8.2 2.95L-8.05 2.7L1.35 -3M-7.2 2.9L1.45 -2.4L-7.2 2.9"
          />
          <path
            fill="none"
            stroke="#000000"
            strokeWidth="var(--ns-stroke, 1)"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M-3.5 -5.4L-2.8 -5.05L-2.7 -5.05L-2.7 -5L1.35 -3L1.4 -3.05M2.45 -1.85L-6.7 4.7L-7 4.8L-7.25 4.6L-8.15 3.25L-8.2 2.95L-8.05 2.7L1.35 -3M7.8 -0.85L14.2 0.2L11.15 -5.5L14.15 -11.3L7.75 -10.15L3.2 -14.75L2.3 -8.3L-3.5 -5.4M3.65 3.55L7.8 -0.85M2.35 -2.55L3.65 3.55"
          />
          <path
            fill="none"
            stroke="#996600"
            strokeWidth="var(--ns-stroke, 1)"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M1.45 -2.4L-7.2 2.9"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={id1}>
          <use
            xlinkHref={`#${id2}`}
            width="100"
            height="8"
            transform="matrix(1, 0, 0, 12.5, 0, 0)"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, -2, -2)" id={id2}>
          <path
            fillRule="evenodd"
            fill="#ff00ff"
            fillOpacity="0"
            stroke="none"
            d="M102 10L2 10L2 2L102 2L102 10"
          />
        </g>
      </defs>
    </svg>
  );
}
