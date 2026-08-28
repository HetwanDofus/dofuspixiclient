"use client";

import { useId } from "react";

export function TurnButtonUp({ className }: { className?: string }) {
  const gradId = useId();
  return (
    <svg
      overflow="visible"
      viewBox="0 0 42 23.95"
      xmlns="http://www.w3.org/2000/svg"
      width="42px"
      height="23.95px"
      className={className}
      shapeRendering="geometricPrecision"
      imageRendering="optimizeQuality"
    >
      <title>End turn</title>
      <g transform="matrix(1, 0, 0, 1, 0.5, 0.45)">
        <path
          fillRule="evenodd"
          fill="#ffa800"
          stroke="none"
          d="M0.9 22.85L0.3 23.3L-0.1 23.35L-0.4 23.15L-0.5 22.75L-0.25 22.45Q12.65 13.9 17.75 -0.05L17.95 -0.3L18.2 -0.4L37 -0.45L37.2 -0.4L37.45 -0.45Q39 -0.35 40.15 0.8Q41.2 1.85 41.45 3.35L41.35 3.7L41.05 3.9L40.95 3.9L40.65 3.8L40.45 3.5Q40.3 2.35 39.45 1.5Q38.6 0.65 37.4 0.55L37.2 0.5L37 0.55L18.55 0.6Q13.45 14.35 0.9 22.85"
        />
        <path
          fillRule="evenodd"
          fill={`url(#${gradId})`}
          stroke="none"
          d="M0.9 22.85Q13.45 14.35 18.55 0.6L37 0.55L37.2 0.5L37.4 0.55Q38.6 0.65 39.45 1.5Q40.3 2.35 40.45 3.5L40.65 3.8L40.95 3.9L40.95 4L41 19.3Q40.9 20.75 39.8 21.85Q38.75 22.9 37.35 23L37 23L0.9 22.85"
        />
        <path
          fill="none"
          stroke="#000066"
          strokeWidth="1"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M40.95 3.9L40.95 4M37.35 23L37 23"
        />
        <path
          fill="none"
          stroke="#402b15"
          strokeWidth="1"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M40.95 4L41 19.3Q40.9 20.75 39.8 21.85Q38.75 22.9 37.35 23M37 23L0.9 22.85"
        />
        <path
          fillRule="evenodd"
          fill="#ffffff"
          stroke="none"
          d="M32 5.5L37.5 11.45L32 17.4L30.45 17.4L30.45 13.8L27.3 13.8L27.3 17.4L24.25 17.4L24.25 13.8L19.55 13.8L19.55 9.05L24.25 9.05L24.25 5.5L27.3 5.5L27.3 9.05L30.45 9.05L30.45 5.5L32 5.5"
        />
      </g>
      <defs>
        <radialGradient
          gradientTransform="matrix(0.012, 0, 0, 0.012, 21.75, 6.45)"
          gradientUnits="userSpaceOnUse"
          spreadMethod="pad"
          id={gradId}
          cx="0"
          cy="0"
          r="819.2"
        >
          <stop offset="0.012" stopColor="#ff8737" />
          <stop offset="1" stopColor="#ff6600" />
        </radialGradient>
      </defs>
    </svg>
  );
}

export function TurnButtonDown({ className }: { className?: string }) {
  const gradId = useId();
  return (
    <svg
      overflow="visible"
      viewBox="0 0 42 23.95"
      xmlns="http://www.w3.org/2000/svg"
      width="42px"
      height="23.95px"
      className={className}
      shapeRendering="geometricPrecision"
      imageRendering="optimizeQuality"
    >
      <title>End turn pressed</title>
      <g transform="matrix(1, 0, 0, 1, 0.5, 0.45)">
        <path
          fillRule="evenodd"
          fill="#402b15"
          stroke="none"
          d="M0.9 22.85L0.3 23.3L-0.1 23.35L-0.4 23.15L-0.5 22.75L-0.25 22.45Q12.65 13.9 17.75 -0.05L17.95 -0.3L18.2 -0.4L37 -0.45L37.2 -0.4L37.45 -0.45Q39 -0.35 40.15 0.8Q41.2 1.85 41.45 3.35L41.35 3.7L41.05 3.9L40.95 3.9L40.65 3.8L40.45 3.5Q40.3 2.35 39.45 1.5Q38.6 0.65 37.4 0.55L37.2 0.5L37 0.55L18.55 0.6Q13.45 14.35 0.9 22.85"
        />
        <path
          fillRule="evenodd"
          fill={`url(#${gradId})`}
          stroke="none"
          d="M0.9 22.85Q13.45 14.35 18.55 0.6L37 0.55L37.2 0.5L37.4 0.55Q38.6 0.65 39.45 1.5Q40.3 2.35 40.45 3.5L40.65 3.8L40.95 3.9L40.95 4L41 19.3Q40.9 20.75 39.8 21.85Q38.75 22.9 37.35 23L37 23L0.9 22.85"
        />
        <path
          fill="none"
          stroke="#000066"
          strokeWidth="1"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M40.95 3.9L40.95 4M37.35 23L37 23"
        />
        <path
          fill="none"
          stroke="#ffa800"
          strokeWidth="1"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M40.95 4L41 19.3Q40.9 20.75 39.8 21.85Q38.75 22.9 37.35 23M37 23L0.9 22.85"
        />
        <path
          fillRule="evenodd"
          fill="#ffffff"
          stroke="none"
          d="M31.45 6.55L33 6.55L38.5 12.5L33 18.45L31.45 18.45L31.45 14.9L28.3 14.9L28.3 18.45L25.25 18.45L25.25 14.9L20.55 14.9L20.55 10.15L25.25 10.15L25.25 6.55L28.3 6.55L28.3 10.15L31.45 10.15L31.45 6.55"
        />
      </g>
      <defs>
        <radialGradient
          gradientTransform="matrix(0.012, 0, 0, 0.012, 31.45, 14.9)"
          gradientUnits="userSpaceOnUse"
          spreadMethod="pad"
          id={gradId}
          cx="0"
          cy="0"
          r="819.2"
        >
          <stop offset="0.012" stopColor="#ff8737" />
          <stop offset="1" stopColor="#ff6600" />
        </radialGradient>
      </defs>
    </svg>
  );
}
