"use client";

import { useId } from "react";

export default function TitleIcon({ className }: { className?: string }) {
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
      <title>Title</title>
      <g transform="matrix(1, 0, 0, 1, 16, 16)">
        <use
          xlinkHref={`#${id0}`}
          width="100"
          height="100"
          transform="matrix(0.32, 0, 0, 0.32, -16, -16)"
        />
        <use
          xlinkHref={`#${id2}`}
          width="19.1"
          height="21.3"
          transform="matrix(1, 0, 0, 1, -9.35, -10.3)"
        />
      </g>
      <defs>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={id0}>
          <use
            xlinkHref={`#${id1}`}
            width="100"
            height="8"
            transform="matrix(1, 0, 0, 12.5, 0, 0)"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, -2, -2)" id={id1}>
          <path
            fillRule="evenodd"
            fill="#ff00ff"
            fillOpacity="0"
            stroke="none"
            d="M102 10L2 10L2 2L102 2L102 10"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 9.35, 10.3)" id={id2}>
          <path
            fillRule="evenodd"
            fill="#fbcb09"
            stroke="none"
            d="M9.1 -9.55L9.25 -9.15L9.25 -5.45L9.1 -4.95L8.6 -4.8L3.35 -4.8L3.35 9.85L3.2 10.4L2.7 10.5L-2.3 10.5L-2.7 10.4L-2.95 9.85L-2.95 -4.8L-8.2 -4.8Q-8.45 -4.8 -8.6 -4.95L-8.85 -5.45L-8.85 -9.15L-8.6 -9.55L-8.2 -9.8L8.6 -9.8L9.1 -9.55M2.3 -5.85L2.7 -6.15L7.95 -6.15L7.95 -8.5L-7.55 -8.5L-7.55 -6.15L-2.3 -6.15L-1.75 -5.85L-1.65 -5.45L-1.65 9.2L2.05 9.2L2.05 -5.45Q2.05 -5.75 2.3 -5.85"
          />
          <path
            fillRule="evenodd"
            fill="#63391d"
            stroke="none"
            d="M2.3 -5.85Q2.05 -5.75 2.05 -5.45L2.05 9.2L-1.65 9.2L-1.65 -5.45L-1.75 -5.85L-2.3 -6.15L-7.55 -6.15L-7.55 -8.5L7.95 -8.5L7.95 -6.15L2.7 -6.15L2.3 -5.85"
          />
          <path
            fill="none"
            stroke="#63391d"
            strokeWidth="1"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9.1 -9.55L8.6 -9.8L-8.2 -9.8L-8.6 -9.55L-8.85 -9.15L-8.85 -5.45L-8.6 -4.95Q-8.45 -4.8 -8.2 -4.8L-2.95 -4.8L-2.95 9.85L-2.7 10.4L-2.3 10.5L2.7 10.5L3.2 10.4L3.35 9.85L3.35 -4.8L8.6 -4.8L9.1 -4.95L9.25 -5.45L9.25 -9.15L9.1 -9.55M2.3 -5.85Q2.05 -5.75 2.05 -5.45L2.05 9.2L-1.65 9.2L-1.65 -5.45L-1.75 -5.85L-2.3 -6.15L-7.55 -6.15L-7.55 -8.5L7.95 -8.5L7.95 -6.15L2.7 -6.15L2.3 -5.85"
          />
          <path
            fillRule="evenodd"
            fill="#63391d"
            stroke="none"
            d="M2.7 -5.45L2.7 9.85L-2.3 9.85L-2.3 -5.45L-8.2 -5.45L-8.2 -9.15L8.6 -9.15L8.6 -5.45L2.7 -5.45"
          />
          <path
            fill="none"
            stroke="#fbcb09"
            strokeWidth="var(--ns-stroke, 1)"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M2.7 -5.45L2.7 9.85L-2.3 9.85L-2.3 -5.45L-8.2 -5.45L-8.2 -9.15L8.6 -9.15L8.6 -5.45L2.7 -5.45"
          />
        </g>
      </defs>
    </svg>
  );
}
