"use client";

import { useId } from "react";

import { cn } from "@/lib/utils";

type IconProps = { className?: string };

export function ButtonChatUp({ className }: IconProps) {
  const uid = useId();

  return (
    <svg
      viewBox="0 0 17 14"
      className={cn("pointer-events-none", className)}
      shapeRendering="geometricPrecision"
      imageRendering="optimizeQuality"
      role="img"
    >
      <title>Open chat</title>
      <g transform="matrix(1, 0, 0, 1, 0, 0)">
        <use
          xlinkHref={`#${uid}-o0`}
          width="17"
          height="14"
          transform="matrix(1, 0, 0, 1, 0, 0)"
        />
      </g>
      <defs>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o0`}>
          <use
            xlinkHref={`#${uid}-o1`}
            width="100"
            height="100"
            transform="matrix(0.12, 0, 0, 0.14, 0, 0)"
          />
          <use
            xlinkHref={`#${uid}-o3`}
            width="100"
            height="100"
            transform="matrix(-0.05, 0, 0, -0.05, 17, 14)"
          />
          <use
            xlinkHref={`#${uid}-o5`}
            width="100"
            height="100"
            transform="matrix(0.05, 0, 0, 0.09, 12, 0)"
          />
          <use
            xlinkHref={`#${uid}-o7`}
            width="100"
            height="100"
            transform="matrix(0.02, 0, 0, 0.08, 7, 3)"
          />
          <use
            xlinkHref={`#${uid}-o9`}
            width="100"
            height="100"
            transform="matrix(0.08, 0, 0, 0.02, 4, 6)"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o1`}>
          <use
            xlinkHref={`#${uid}-o2`}
            width="100"
            height="100"
            transform="matrix(1, 0, 0, 1, 0, 0)"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o2`}>
          <path
            fillRule="evenodd"
            fill="#ffffff"
            stroke="#ffffff"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            d="M0 0L100 0L100 100L0 100L0 0"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o3`}>
          <use
            xlinkHref={`#${uid}-o4`}
            width="100"
            height="100"
            transform="matrix(1, 0, 0, 1, 0, 0)"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o4`}>
          <path
            fillRule="evenodd"
            fill="#ffffff"
            stroke="#ffffff"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            d="M0 99.95Q0 58.6 29.25 29.25Q58.55 0 100 0L100 100L0 100L0 99.95"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o5`}>
          <use
            xlinkHref={`#${uid}-o6`}
            width="100"
            height="100"
            transform="matrix(1, 0, 0, 1, 0, 0)"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o6`}>
          <path
            fillRule="evenodd"
            fill="#ffffff"
            stroke="#ffffff"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            d="M0 0L100 0L100 100L0 100L0 0"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o7`}>
          <use
            xlinkHref={`#${uid}-o8`}
            width="100"
            height="100"
            transform="matrix(1, 0, 0, 1, 0, 0)"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o8`}>
          <path
            fillRule="evenodd"
            fill="#ff6600"
            stroke="#ff6600"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            d="M0 0L100 0L100 100L0 100L0 0"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o9`}>
          <use
            xlinkHref={`#${uid}-o10`}
            width="100"
            height="100"
            transform="matrix(1, 0, 0, 1, 0, 0)"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o10`}>
          <path
            fillRule="evenodd"
            fill="#ff6600"
            stroke="#ff6600"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            d="M0 0L100 0L100 100L0 100L0 0"
          />
        </g>
      </defs>
    </svg>
  );
}

export function ButtonChatDown({ className }: IconProps) {
  const uid = useId();

  return (
    <svg
      viewBox="0 0 17 14"
      className={cn("pointer-events-none", className)}
      shapeRendering="geometricPrecision"
      imageRendering="optimizeQuality"
      role="img"
    >
      <title>Close chat</title>
      <g transform="matrix(1, 0, 0, 1, 0, 0)">
        <use
          xlinkHref={`#${uid}-o0`}
          width="17"
          height="14"
          transform="matrix(1, 0, 0, 1, 0, 0)"
        />
      </g>
      <defs>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o0`}>
          <use
            xlinkHref={`#${uid}-o1`}
            width="100"
            height="100"
            transform="matrix(0.12, 0, 0, 0.14, 0, 0)"
          />
          <use
            xlinkHref={`#${uid}-o3`}
            width="100"
            height="100"
            transform="matrix(-0.05, 0, 0, -0.05, 17, 14)"
          />
          <use
            xlinkHref={`#${uid}-o5`}
            width="100"
            height="100"
            transform="matrix(0.05, 0, 0, 0.09, 12, 0)"
          />
          <use
            xlinkHref={`#${uid}-o7`}
            width="100"
            height="100"
            transform="matrix(0.08, 0, 0, 0.02, 4, 6)"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o1`}>
          <use
            xlinkHref={`#${uid}-o2`}
            width="100"
            height="100"
            transform="matrix(1, 0, 0, 1, 0, 0)"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o2`}>
          <path
            fillRule="evenodd"
            fill="#ffffff"
            stroke="#ffffff"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            d="M0 0L100 0L100 100L0 100L0 0"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o3`}>
          <use
            xlinkHref={`#${uid}-o4`}
            width="100"
            height="100"
            transform="matrix(1, 0, 0, 1, 0, 0)"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o4`}>
          <path
            fillRule="evenodd"
            fill="#ffffff"
            stroke="#ffffff"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            d="M0 99.95Q0 58.6 29.25 29.25Q58.55 0 100 0L100 100L0 100L0 99.95"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o5`}>
          <use
            xlinkHref={`#${uid}-o6`}
            width="100"
            height="100"
            transform="matrix(1, 0, 0, 1, 0, 0)"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o6`}>
          <path
            fillRule="evenodd"
            fill="#ffffff"
            stroke="#ffffff"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            d="M0 0L100 0L100 100L0 100L0 0"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o7`}>
          <use
            xlinkHref={`#${uid}-o8`}
            width="100"
            height="100"
            transform="matrix(1, 0, 0, 1, 0, 0)"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o8`}>
          <path
            fillRule="evenodd"
            fill="#ff6600"
            stroke="#ff6600"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            d="M0 0L100 0L100 100L0 100L0 0"
          />
        </g>
      </defs>
    </svg>
  );
}

export function ButtonEmoteUp({ className }: IconProps) {
  const uid = useId();

  return (
    <svg
      viewBox="0 0 20 14"
      className={cn("pointer-events-none", className)}
      shapeRendering="geometricPrecision"
      imageRendering="optimizeQuality"
      role="img"
    >
      <title>Open emotes</title>
      <g transform="matrix(1, 0, 0, 1, 0, 0)">
        <use
          xlinkHref={`#${uid}-o0`}
          width="20"
          height="14"
          transform="matrix(1, 0, 0, 1, 0, 0)"
        />
      </g>
      <defs>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o0`}>
          <use
            xlinkHref={`#${uid}-o1`}
            width="100"
            height="100"
            transform="matrix(0.1, 0, 0, 0.14, 5, 0)"
          />
          <use
            xlinkHref={`#${uid}-o3`}
            width="100"
            height="100"
            transform="matrix(-0.05, 0, 0, -0.05, 20, 14)"
          />
          <use
            xlinkHref={`#${uid}-o5`}
            width="100"
            height="100"
            transform="matrix(0.05, 0, 0, 0.09, 15, 0)"
          />
          <use
            xlinkHref={`#${uid}-o7`}
            width="100"
            height="100"
            transform="matrix(0.05, 0, 0, -0.05, 0, 14)"
          />
          <use
            xlinkHref={`#${uid}-o9`}
            width="100"
            height="100"
            transform="matrix(-0.05, 0, 0, 0.09, 5, 0)"
          />
          <use
            xlinkHref={`#${uid}-o11`}
            width="15"
            height="15"
            transform="matrix(0.6693, 0, 0, 0.6667, 5, 2)"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o1`}>
          <use
            xlinkHref={`#${uid}-o2`}
            width="100"
            height="100"
            transform="matrix(1, 0, 0, 1, 0, 0)"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o2`}>
          <path
            fillRule="evenodd"
            fill="#ffffff"
            stroke="#ffffff"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            d="M0 0L100 0L100 100L0 100L0 0"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o3`}>
          <use
            xlinkHref={`#${uid}-o4`}
            width="100"
            height="100"
            transform="matrix(1, 0, 0, 1, 0, 0)"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o4`}>
          <path
            fillRule="evenodd"
            fill="#ffffff"
            stroke="#ffffff"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            d="M0 99.95Q0 58.6 29.25 29.25Q58.55 0 100 0L100 100L0 100L0 99.95"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o5`}>
          <use
            xlinkHref={`#${uid}-o6`}
            width="100"
            height="100"
            transform="matrix(1, 0, 0, 1, 0, 0)"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o6`}>
          <path
            fillRule="evenodd"
            fill="#ffffff"
            stroke="#ffffff"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            d="M0 0L100 0L100 100L0 100L0 0"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o7`}>
          <use
            xlinkHref={`#${uid}-o8`}
            width="100"
            height="100"
            transform="matrix(1, 0, 0, 1, 0, 0)"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o8`}>
          <path
            fillRule="evenodd"
            fill="#ffffff"
            stroke="#ffffff"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            d="M0 99.95Q0 58.6 29.25 29.25Q58.55 0 100 0L100 100L0 100L0 99.95"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o9`}>
          <use
            xlinkHref={`#${uid}-o10`}
            width="100"
            height="100"
            transform="matrix(1, 0, 0, 1, 0, 0)"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o10`}>
          <path
            fillRule="evenodd"
            fill="#ffffff"
            stroke="#ffffff"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            d="M0 0L100 0L100 100L0 100L0 0"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 7.5, 7.5)" id={`${uid}-o11`}>
          <use
            xlinkHref={`#${uid}-o12`}
            width="15"
            height="15"
            transform="matrix(1, 0, 0, 1, -7.5, -7.5)"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 7.5, 7.5)" id={`${uid}-o12`}>
          <path
            fillRule="evenodd"
            fill="#791800"
            stroke="#791800"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            d="M2.95 -1.1L4.3 -0.55L4.6 -2.45L1.8 -3.65L1.15 -3.35L0.8 -4.3L-0.4 -4.6L-1.05 -4.1L-1.5 -4.65L-2.9 -4.65L-3.25 -4.05L-4.05 -4.45L-4.25 -4.25L-4.3 -4.15L-4.4 -4.1L-4.45 -3.55L-4.6 -3.45L-4.75 -3.6L-5.2 -3.6L-5.55 -2.75L-5.7 -2.7L-5.8 -2.3Q-6 -1.6 -5.8 -0.85L-5.6 0.45L-5.45 1.4L-4.75 2.3L-4.7 2.3L-5.3 0.55L-4.9 -0.7L-4.15 -1.2L-4.2 -1.2L-4.05 -1.25L-3.9 -1.3L-2.3 -1.6L-1.2 -1.75L-1.8 -0.85Q-2.55 0.6 -2.45 2.4L-2.75 2.5L-3.75 3.1L-4.7 3.75L-4.1 4.1L-3.05 4.35L-2.9 3.8L-2.2 4.25L-1.85 4.15L-1.5 3.3L-1 3.65Q-0.85 3.5 0.5 3.1L2.05 2.4L2.1 1.7L2.2 1.55L2.7 0.65Q3.05 -0.1 2.95 -1.1M-0.05 -1.75L1.15 -1.6L0.95 -0.95Q0.9 -0.45 1 -0.2L1.05 0.35L1 0.4L0.65 0.6L0.45 0.65L0.05 0.35L-0.15 -0.15L0.25 -1.1L0.2 -1.6L-0.05 -1.75M-6.6 -0.8L-6.1 -2.45L-6.1 -2.7L-6 -2.7L-5.95 -2.75L-6 -2.9L-5.85 -2.95L-5.8 -3.25L-5.5 -3.45Q-5.1 -3.8 -4.95 -4.35L-4.55 -4.55L-2.95 -5.35L-2.8 -5.45Q0.95 -5.2 4.35 -3.15Q4.45 -2.75 4.7 -2.5L4.65 -2.55L4.85 -2.35L5.45 -1.6Q5.5 -0.8 5.1 -0.2L4.3 0.75L4.5 0.65L3.9 1.3Q1.95 3.55 -0.7 4.55L-1.65 4.95L-1.8 5L-2.05 5.05L-2.5 5.15L-2.6 5.15L-4.1 4.7Q-4.35 4.55 -4.55 4.45L-4.65 4.25L-4.7 4.1L-4.75 3.95L-4.8 3.55L-4.95 3.3L-5.15 3.2L-5.35 3.15L-5.7 2.25L-6.45 0.15L-6.6 -0.8M-3.05 1.15L-3.1 1.15L-3.05 1.15"
          />
          <path
            fillRule="evenodd"
            fill="#ffffff"
            stroke="#ffffff"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            d="M-1.2 -1.75L-2.3 -1.6L-3.9 -1.3L-4.05 -1.25L-4.2 -1.2L-4.15 -1.2L-4.9 -0.7L-5.3 0.55L-4.7 2.3L-4.75 2.3L-5.45 1.4L-5.6 0.45L-5.8 -0.85Q-6 -1.6 -5.8 -2.3L-5.7 -2.7L-5.55 -2.75L-5.2 -3.6L-4.75 -3.6L-4.6 -3.45L-4.45 -3.55L-4.4 -4.1L-4.3 -4.15L-4.25 -4.25L-4.05 -4.45L-3.25 -4.05L-2.9 -4.65L-1.5 -4.65L-1.05 -4.1L-0.4 -4.6L0.8 -4.3L1.15 -3.35L1.8 -3.65L4.6 -2.45L4.3 -0.55L2.95 -1.1L1.15 -1.6L-0.05 -1.75L-1.2 -1.75M2.1 1.7L2.05 2.4L0.5 3.1Q-0.85 3.5 -1 3.65L-1.5 3.3L-1.85 4.15L-2.2 4.25L-2.9 3.8L-3.05 4.35L-4.1 4.1L-4.7 3.75L-3.75 3.1L-2.75 2.5L-2.45 2.4L0.05 1.8L2.1 1.7M-3.05 1.15L-3.1 1.15L-3.05 1.15"
          />
          <path
            fillRule="evenodd"
            fill="#000000"
            stroke="#000000"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            d="M2.95 -1.1Q3.05 -0.1 2.7 0.65L2.2 1.55L2.1 1.7L0.05 1.8L-2.45 2.4Q-2.55 0.6 -1.8 -0.85L-1.2 -1.75L-0.05 -1.75L0.2 -1.6L0.25 -1.1L-0.15 -0.15L0.05 0.35L0.45 0.65L0.65 0.6L1 0.4L1.05 0.35L1 -0.2Q0.9 -0.45 0.95 -0.95L1.15 -1.6L2.95 -1.1M-6.6 -0.8L-6.45 0.15L-5.7 2.25L-5.35 3.15L-5.7 3.4Q-5.2 7.35 -1.65 6.75Q1.1 6.25 3.25 4L4.25 2.75L4.8 1.9L5.25 1.05L5.55 0.45L5.65 0.4L6.8 -1.7L5.3 -3.2Q2.3 -5.9 0.35 -6.5L-2.65 -6.35L-4.5 -6.25Q-5.5 -5.85 -6.05 -4.3L-6.85 -1L-6.6 -0.8M-2.5 5.15L-2.05 5.05L-1.8 5L-1.65 4.95L-2 5.1L-2.5 5.15M7.5 -1.85L6.25 0.45L6.1 0.5L5.8 1.15L5.3 2.1L4.75 3.05L3.6 4.4Q1.25 6.85 -1.75 7.4Q-5.7 8.1 -6.25 3.75L-5.85 3.45L-6.25 2.5L-7.05 0.15L-7.2 -0.9L-7.5 -1.1Q-7.25 -3.05 -6.6 -4.75Q-6 -6.45 -4.9 -6.9L-2.9 -7L0.4 -7.2Q2.55 -6.5 5.85 -3.55L7.5 -1.85"
          />
          <path
            fillRule="evenodd"
            fill="#ff3300"
            stroke="#ff3300"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            d="M-1.65 4.95L-0.7 4.55Q1.95 3.55 3.9 1.3L4.5 0.65L4.3 0.75L5.1 -0.2Q5.5 -0.8 5.45 -1.6L4.85 -2.35L4.65 -2.55L4.7 -2.5Q4.45 -2.75 4.35 -3.15Q0.95 -5.2 -2.8 -5.45L-2.95 -5.35L-4.55 -4.55L-4.95 -4.35Q-5.1 -3.8 -5.5 -3.45L-5.8 -3.25L-5.85 -2.95L-6 -2.9L-5.95 -2.75L-6 -2.7L-6.1 -2.7L-6.1 -2.45L-6.6 -0.8L-6.85 -1L-6.05 -4.3Q-5.5 -5.85 -4.5 -6.25L-2.65 -6.35L0.35 -6.5Q2.3 -5.9 5.3 -3.2L6.8 -1.7L5.65 0.4L5.55 0.45L5.25 1.05L4.8 1.9L4.25 2.75L3.25 4Q1.1 6.25 -1.65 6.75Q-5.2 7.35 -5.7 3.4L-5.35 3.15L-5.15 3.2L-4.95 3.3L-4.8 3.55L-4.75 3.95L-4.7 4.1L-4.65 4.25L-4.55 4.45Q-4.35 4.55 -4.1 4.7L-2.6 5.15L-2.5 5.15L-2 5.1L-1.65 4.95"
          />
        </g>
      </defs>
    </svg>
  );
}

export function ButtonEmoteDown({ className }: IconProps) {
  const uid = useId();

  return (
    <svg
      viewBox="0 0 20 14"
      className={cn("pointer-events-none", className)}
      shapeRendering="geometricPrecision"
      imageRendering="optimizeQuality"
      role="img"
    >
      <title>Close emotes</title>
      <g transform="matrix(1, 0, 0, 1, 0, 0)">
        <use
          xlinkHref={`#${uid}-o0`}
          width="20"
          height="14"
          transform="matrix(1, 0, 0, 1, 0, 0)"
        />
      </g>
      <defs>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o0`}>
          <use
            xlinkHref={`#${uid}-o1`}
            width="100"
            height="100"
            transform="matrix(0.1, 0, 0, 0.14, 5, 0)"
          />
          <use
            xlinkHref={`#${uid}-o3`}
            width="100"
            height="100"
            transform="matrix(-0.05, 0, 0, -0.05, 20, 14)"
          />
          <use
            xlinkHref={`#${uid}-o5`}
            width="100"
            height="100"
            transform="matrix(0.05, 0, 0, 0.09, 15, 0)"
          />
          <use
            xlinkHref={`#${uid}-o7`}
            width="100"
            height="100"
            transform="matrix(0.05, 0, 0, -0.05, 0, 14)"
          />
          <use
            xlinkHref={`#${uid}-o9`}
            width="100"
            height="100"
            transform="matrix(-0.05, 0, 0, 0.09, 5, 0)"
          />
          <use
            xlinkHref={`#${uid}-o11`}
            width="15"
            height="15"
            transform="matrix(0.6693, 0, 0, 0.6667, 5, 2)"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o1`}>
          <use
            xlinkHref={`#${uid}-o2`}
            width="100"
            height="100"
            transform="matrix(1, 0, 0, 1, 0, 0)"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o2`}>
          <path
            fillRule="evenodd"
            fill="#ffffff"
            stroke="#ffffff"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            d="M0 0L100 0L100 100L0 100L0 0"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o3`}>
          <use
            xlinkHref={`#${uid}-o4`}
            width="100"
            height="100"
            transform="matrix(1, 0, 0, 1, 0, 0)"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o4`}>
          <path
            fillRule="evenodd"
            fill="#ffffff"
            stroke="#ffffff"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            d="M0 99.95Q0 58.6 29.25 29.25Q58.55 0 100 0L100 100L0 100L0 99.95"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o5`}>
          <use
            xlinkHref={`#${uid}-o6`}
            width="100"
            height="100"
            transform="matrix(1, 0, 0, 1, 0, 0)"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o6`}>
          <path
            fillRule="evenodd"
            fill="#ffffff"
            stroke="#ffffff"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            d="M0 0L100 0L100 100L0 100L0 0"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o7`}>
          <use
            xlinkHref={`#${uid}-o8`}
            width="100"
            height="100"
            transform="matrix(1, 0, 0, 1, 0, 0)"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o8`}>
          <path
            fillRule="evenodd"
            fill="#ffffff"
            stroke="#ffffff"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            d="M0 99.95Q0 58.6 29.25 29.25Q58.55 0 100 0L100 100L0 100L0 99.95"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o9`}>
          <use
            xlinkHref={`#${uid}-o10`}
            width="100"
            height="100"
            transform="matrix(1, 0, 0, 1, 0, 0)"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o10`}>
          <path
            fillRule="evenodd"
            fill="#ffffff"
            stroke="#ffffff"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            d="M0 0L100 0L100 100L0 100L0 0"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 7.5, 7.5)" id={`${uid}-o11`}>
          <use
            xlinkHref={`#${uid}-o12`}
            width="15"
            height="15"
            transform="matrix(1, 0, 0, 1, -7.5, -7.5)"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 7.5, 7.5)" id={`${uid}-o12`}>
          <path
            fillRule="evenodd"
            fill="#791800"
            fillOpacity="0.49803921568627"
            stroke="none"
            d="M2.95 -1.1L4.3 -0.55L4.6 -2.45L1.8 -3.65L1.15 -3.35L0.8 -4.3L-0.4 -4.6L-1.05 -4.1L-1.5 -4.65L-2.9 -4.65L-3.25 -4.05L-4.05 -4.45L-4.25 -4.25L-4.3 -4.15L-4.4 -4.1L-4.45 -3.55L-4.6 -3.45L-4.75 -3.6L-5.2 -3.6L-5.55 -2.75L-5.7 -2.7L-5.8 -2.3Q-6 -1.6 -5.8 -0.85L-5.6 0.45L-5.45 1.4L-4.75 2.3L-4.7 2.3L-5.3 0.55L-4.9 -0.7L-4.15 -1.2L-4.2 -1.2L-4.05 -1.25L-3.9 -1.3L-2.3 -1.6L-1.2 -1.75L-1.8 -0.85Q-2.55 0.6 -2.45 2.4L-2.75 2.5L-3.75 3.1L-4.7 3.75L-4.1 4.1L-3.05 4.35L-2.9 3.8L-2.2 4.25L-1.85 4.15L-1.5 3.3L-1 3.65Q-0.85 3.5 0.5 3.1L2.05 2.4L2.1 1.7L2.2 1.55L2.7 0.65Q3.05 -0.1 2.95 -1.1M-0.05 -1.75L1.15 -1.6L0.95 -0.95Q0.9 -0.45 1 -0.2L1.05 0.35L1 0.4L0.65 0.6L0.45 0.65L0.05 0.35L-0.15 -0.15L0.25 -1.1L0.2 -1.6L-0.05 -1.75M-6.6 -0.8L-6.1 -2.45L-6.1 -2.7L-6 -2.7L-5.95 -2.75L-6 -2.9L-5.85 -2.95L-5.8 -3.25L-5.5 -3.45Q-5.1 -3.8 -4.95 -4.35L-4.55 -4.55L-2.95 -5.35L-2.8 -5.45Q0.95 -5.2 4.35 -3.15Q4.45 -2.75 4.7 -2.5L4.65 -2.55L4.85 -2.35L5.45 -1.6Q5.5 -0.8 5.1 -0.2L4.3 0.75L4.5 0.65L3.9 1.3Q1.95 3.55 -0.7 4.55L-1.65 4.95L-1.8 5L-2.05 5.05L-2.5 5.15L-2.6 5.15L-4.1 4.7Q-4.35 4.55 -4.55 4.45L-4.65 4.25L-4.7 4.1L-4.75 3.95L-4.8 3.55L-4.95 3.3L-5.15 3.2L-5.35 3.15L-5.7 2.25L-6.45 0.15L-6.6 -0.8M-3.05 1.15L-3.1 1.15L-3.05 1.15"
          />
          <path
            fillRule="evenodd"
            fill="#ffffff"
            fillOpacity="0.49803921568627"
            stroke="none"
            d="M-1.2 -1.75L-2.3 -1.6L-3.9 -1.3L-4.05 -1.25L-4.2 -1.2L-4.15 -1.2L-4.9 -0.7L-5.3 0.55L-4.7 2.3L-4.75 2.3L-5.45 1.4L-5.6 0.45L-5.8 -0.85Q-6 -1.6 -5.8 -2.3L-5.7 -2.7L-5.55 -2.75L-5.2 -3.6L-4.75 -3.6L-4.6 -3.45L-4.45 -3.55L-4.4 -4.1L-4.3 -4.15L-4.25 -4.25L-4.05 -4.45L-3.25 -4.05L-2.9 -4.65L-1.5 -4.65L-1.05 -4.1L-0.4 -4.6L0.8 -4.3L1.15 -3.35L1.8 -3.65L4.6 -2.45L4.3 -0.55L2.95 -1.1L1.15 -1.6L-0.05 -1.75L-1.2 -1.75M2.1 1.7L2.05 2.4L0.5 3.1Q-0.85 3.5 -1 3.65L-1.5 3.3L-1.85 4.15L-2.2 4.25L-2.9 3.8L-3.05 4.35L-4.1 4.1L-4.7 3.75L-3.75 3.1L-2.75 2.5L-2.45 2.4L0.05 1.8L2.1 1.7M-3.05 1.15L-3.1 1.15L-3.05 1.15"
          />
          <path
            fillRule="evenodd"
            fill="#000000"
            fillOpacity="0.49803921568627"
            stroke="none"
            d="M2.95 -1.1Q3.05 -0.1 2.7 0.65L2.2 1.55L2.1 1.7L0.05 1.8L-2.45 2.4Q-2.55 0.6 -1.8 -0.85L-1.2 -1.75L-0.05 -1.75L0.2 -1.6L0.25 -1.1L-0.15 -0.15L0.05 0.35L0.45 0.65L0.65 0.6L1 0.4L1.05 0.35L1 -0.2Q0.9 -0.45 0.95 -0.95L1.15 -1.6L2.95 -1.1M-6.6 -0.8L-6.45 0.15L-5.7 2.25L-5.35 3.15L-5.7 3.4Q-5.2 7.35 -1.65 6.75Q1.1 6.25 3.25 4L4.25 2.75L4.8 1.9L5.25 1.05L5.55 0.45L5.65 0.4L6.8 -1.7L5.3 -3.2Q2.3 -5.9 0.35 -6.5L-2.65 -6.35L-4.5 -6.25Q-5.5 -5.85 -6.05 -4.3L-6.85 -1L-6.6 -0.8M-2.5 5.15L-2.05 5.05L-1.8 5L-1.65 4.95L-2 5.1L-2.5 5.15M7.5 -1.85L6.25 0.45L6.1 0.5L5.8 1.15L5.3 2.1L4.75 3.05L3.6 4.4Q1.25 6.85 -1.75 7.4Q-5.7 8.1 -6.25 3.75L-5.85 3.45L-6.25 2.5L-7.05 0.15L-7.2 -0.9L-7.5 -1.1Q-7.25 -3.05 -6.6 -4.75Q-6 -6.45 -4.9 -6.9L-2.9 -7L0.4 -7.2Q2.55 -6.5 5.85 -3.55L7.5 -1.85"
          />
          <path
            fillRule="evenodd"
            fill="#ff3300"
            fillOpacity="0.49803921568627"
            stroke="none"
            d="M-1.65 4.95L-0.7 4.55Q1.95 3.55 3.9 1.3L4.5 0.65L4.3 0.75L5.1 -0.2Q5.5 -0.8 5.45 -1.6L4.85 -2.35L4.65 -2.55L4.7 -2.5Q4.45 -2.75 4.35 -3.15Q0.95 -5.2 -2.8 -5.45L-2.95 -5.35L-4.55 -4.55L-4.95 -4.35Q-5.1 -3.8 -5.5 -3.45L-5.8 -3.25L-5.85 -2.95L-6 -2.9L-5.95 -2.75L-6 -2.7L-6.1 -2.7L-6.1 -2.45L-6.6 -0.8L-6.85 -1L-6.05 -4.3Q-5.5 -5.85 -4.5 -6.25L-2.65 -6.35L0.35 -6.5Q2.3 -5.9 5.3 -3.2L6.8 -1.7L5.65 0.4L5.55 0.45L5.25 1.05L4.8 1.9L4.25 2.75L3.25 4Q1.1 6.25 -1.65 6.75Q-5.2 7.35 -5.7 3.4L-5.35 3.15L-5.15 3.2L-4.95 3.3L-4.8 3.55L-4.75 3.95L-4.7 4.1L-4.65 4.25L-4.55 4.45Q-4.35 4.55 -4.1 4.7L-2.6 5.15L-2.5 5.15L-2 5.1L-1.65 4.95"
          />
        </g>
      </defs>
    </svg>
  );
}

export function ButtonSitUp({ className }: IconProps) {
  const uid = useId();

  return (
    <svg
      viewBox="0 0 20 14"
      className={cn("pointer-events-none", className)}
      shapeRendering="geometricPrecision"
      imageRendering="optimizeQuality"
      role="img"
    >
      <title>Sit down</title>
      <g transform="matrix(1, 0, 0, 1, 0, 0)">
        <use
          xlinkHref={`#${uid}-o0`}
          width="20"
          height="14"
          transform="matrix(1, 0, 0, 1, 0, 0)"
        />
      </g>
      <defs>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o0`}>
          <use
            xlinkHref={`#${uid}-o1`}
            width="10.65"
            height="10.45"
            transform="matrix(1, 0, 0, 1, 4.7, 2.8)"
          />
          <use
            xlinkHref={`#${uid}-o2`}
            width="100"
            height="100"
            transform="matrix(0.1, 0, 0, 0.14, 5, 0)"
          />
          <use
            xlinkHref={`#${uid}-o4`}
            width="100"
            height="100"
            transform="matrix(-0.05, 0, 0, -0.05, 20, 14)"
          />
          <use
            xlinkHref={`#${uid}-o6`}
            width="100"
            height="100"
            transform="matrix(0.05, 0, 0, 0.09, 15, 0)"
          />
          <use
            xlinkHref={`#${uid}-o8`}
            width="100"
            height="100"
            transform="matrix(0.05, 0, 0, -0.05, 0, 14)"
          />
          <use
            xlinkHref={`#${uid}-o10`}
            width="100"
            height="100"
            transform="matrix(-0.05, 0, 0, 0.09, 5, 0)"
          />
          <use
            xlinkHref={`#${uid}-o12`}
            width="11.3"
            height="11.8"
            transform="matrix(1, 0, 0, 1, 4.2, 1.15)"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, -4.7, -2.8)" id={`${uid}-o1`}>
          <path
            fillRule="evenodd"
            fill="#000000"
            stroke="#000000"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            d="M15.2 2.85L15.25 2.85L15.25 2.9L15.2 2.85M13.85 5L13.9 4.95L13.85 6.25L13.65 6.85L15.35 10.15L15.05 11.1L13.75 11.25L12.35 7.8L11.55 8.05L10.9 8.2L9.9 8.25L9.3 8.25L8.6 8.15L8.25 8.05L7.65 7.9L6.6 11.15L5.7 11.65L4.7 10.85L6.3 7L6 6.25L6 5.1L6 4.8Q6 4.4 6.3 4.05L6.25 4L6.25 3.9L6.35 3.85L6.45 3.85L7.15 3.35L7.7 3.1L7.8 3.1L7.8 3L7.9 2.95L8 2.95L8.1 3L9.85 2.8Q10.75 2.8 12.45 3.5Q14.15 4.2 13.85 4.65L13.9 4.7L13.85 4.75L13.85 4.8L13.85 5M10.45 8.35L10.75 8.35L10.9 9.1L11.15 12.45L10.55 13.25L9.3 12.9L9.2 8.35L10.45 8.35"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o2`}>
          <use
            xlinkHref={`#${uid}-o3`}
            width="100"
            height="100"
            transform="matrix(1, 0, 0, 1, 0, 0)"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o3`}>
          <path
            fillRule="evenodd"
            fill="#ffffff"
            stroke="#ffffff"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            d="M0 0L100 0L100 100L0 100L0 0"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o4`}>
          <use
            xlinkHref={`#${uid}-o5`}
            width="100"
            height="100"
            transform="matrix(1, 0, 0, 1, 0, 0)"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o5`}>
          <path
            fillRule="evenodd"
            fill="#ffffff"
            stroke="#ffffff"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            d="M0 99.95Q0 58.6 29.25 29.25Q58.55 0 100 0L100 100L0 100L0 99.95"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o6`}>
          <use
            xlinkHref={`#${uid}-o7`}
            width="100"
            height="100"
            transform="matrix(1, 0, 0, 1, 0, 0)"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o7`}>
          <path
            fillRule="evenodd"
            fill="#ffffff"
            stroke="#ffffff"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            d="M0 0L100 0L100 100L0 100L0 0"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o8`}>
          <use
            xlinkHref={`#${uid}-o9`}
            width="100"
            height="100"
            transform="matrix(1, 0, 0, 1, 0, 0)"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o9`}>
          <path
            fillRule="evenodd"
            fill="#ffffff"
            stroke="#ffffff"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            d="M0 99.95Q0 58.6 29.25 29.25Q58.55 0 100 0L100 100L0 100L0 99.95"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o10`}>
          <use
            xlinkHref={`#${uid}-o11`}
            width="100"
            height="100"
            transform="matrix(1, 0, 0, 1, 0, 0)"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o11`}>
          <path
            fillRule="evenodd"
            fill="#ffffff"
            stroke="#ffffff"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            d="M0 0L100 0L100 100L0 100L0 0"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, -4.2, -1.15)" id={`${uid}-o12`}>
          <path
            fillRule="evenodd"
            fill="#715120"
            stroke="#715120"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            d="M8.25 5.55L9.5 5.75L9.55 5.75L10.3 5.8L10.65 5.8L10.7 7.4L10.3 7.4L10.05 7.45L9.15 7.4L8.8 7.4L8.4 7.2L8.25 5.55"
          />
          <path
            fillRule="evenodd"
            fill="#986b29"
            stroke="#986b29"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            d="M10.65 5.8L10.3 5.8L9.55 5.75L9.5 5.75L8.25 5.55L7.1 5.1L6.45 4.75L6.25 4.6L5.8 3.75L5.8 3.45Q5.8 2.95 6.1 2.6Q7.85 3.75 10.15 4.6L12.7 5.3L12.85 5.3L12.85 5.15L12.85 5L6.25 2.35Q6.5 2.05 7.1 1.8Q7.35 1.6 7.75 1.55L7.85 1.45L7.9 1.6L9.95 2.6L10.8 3Q12.35 3.6 14.25 4L14.4 3.9L14.4 3.75L14.35 3.7L14.25 3.7L8.25 1.4L10.2 1.15Q11.3 1.15 13.25 1.95Q15.25 2.75 14.8 3.25L14.8 3.45L14.9 3.5L14.8 3.6L14.5 4.4L13.5 5.1L13.35 5.15L12.85 5.4L11.3 5.75L10.65 5.8M14.15 10.5L13 10L12.5 7.8L13.25 7.6L13.35 7.7L13.25 7.6L13.35 7.6L13.35 7.7L14.15 10.5M10.4 12.95L9.05 12.4L9.25 8.1L10.15 8.3L10.2 8.75L10.15 8.3L10.2 8.3L10.2 8.75L10.4 12.95M5.8 6.45L6.45 7.3L6.35 7.45L5.35 10.75L4.2 10.25L5.8 6.45"
          />
          <path
            fillRule="evenodd"
            fill="#72511f"
            stroke="#72511f"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            d="M8.25 5.55L8.4 7.2L8.35 7.2L8.1 7.2L7.9 7.15L7.6 6.95L6.5 6.3L6.5 6.4L6.35 6.3L6.45 4.75L7.1 5.1L8.25 5.55M14.25 6.9L15.5 9.35L14.25 10.5L14.15 10.5L13.35 7.7L13.35 7.6L14.25 6.9M11.05 7.8L11.55 12.05L10.4 12.95L10.2 8.75L10.2 8.3L11.05 7.8M7.4 7.6L6.7 10.15L5.35 10.75L6.35 7.45L7.4 7.6"
          />
          <path
            fillRule="evenodd"
            fill="#6f4f1e"
            stroke="#6f4f1e"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            d="M9.15 7.4L10.05 7.45L10.15 8.3L9.25 8.1L9.15 7.4M8.25 1.4L14.25 3.7L14.35 3.7L14.4 3.75L14.4 3.9L14.25 4Q12.35 3.6 10.8 3L9.95 2.6L7.9 1.6L7.85 1.45L7.85 1.4L7.9 1.3L8.1 1.3L8.25 1.4M6.25 2.35L12.85 5L12.85 5.15L12.85 5.3L12.7 5.3L10.15 4.6Q7.85 3.75 6.1 2.6L6.1 2.55L6.1 2.45L6.1 2.35L6.25 2.35M12.5 7.8L12.25 7.2L13 6.95L13.25 7.6L12.5 7.8M5.95 5.85L5.95 5.8L6 5.9L6.2 6.15L6.2 6.25L6.35 6.3L6.5 6.4L6.7 6.55L6.45 7.3L5.8 6.45L5.95 5.85L6 5.9L5.95 5.85"
          />
          <path
            fillRule="evenodd"
            fill="#493414"
            stroke="#493414"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            d="M10.05 7.45L10.3 7.4L10.7 7.4L10.95 7.2L11.2 7.4L11.05 7.8L10.2 8.3L10.15 8.3L10.05 7.45M14 6.45L14.25 6.9L13.35 7.6L13.25 7.6L13 6.95L14 6.45M6.45 7.3L6.7 6.55L6.5 6.4L6.5 6.3L7.6 6.95L7.4 7.6L6.35 7.45L6.45 7.3"
          />
          <path
            fillRule="evenodd"
            fill="#5b411a"
            stroke="#5b411a"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            d="M10.7 7.4L10.65 5.8L11.3 5.75L12.85 5.4L13.35 5.15L13.5 5.1L14.5 4.4L14.8 3.6L15 3.7L14.8 5.15Q14.8 5.9 14 6.45L13 6.95L12.25 7.2L12.2 7.2L11.45 7.4L11.2 7.4L10.95 7.2L10.7 7.4"
          />
          <path
            fillRule="evenodd"
            fill="#d8a738"
            stroke="#d8a738"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            d="M14.9 3.5L14.8 3.45L14.8 3.25L14.9 3.35L14.9 3.45L14.9 3.5"
          />
          <path
            fillRule="evenodd"
            fill="#916728"
            stroke="#916728"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            d="M5.8 3.75L6.25 4.6L6.45 4.75L6.35 6.3L6.2 6.25L6.2 6.15L6 5.9L5.95 5.8L5.95 5.85Q5.7 5.45 5.8 5.15L5.8 3.75"
          />
          <path
            fill="none"
            stroke="#603c0f"
            strokeOpacity="0.61960784313725"
            vectorEffect="non-scaling-stroke"
            strokeWidth="1"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M10.65 5.8L10.3 5.8L9.55 5.75L9.5 5.75L8.25 5.55L8.4 7.2L8.8 7.4L9.15 7.4L10.05 7.45L10.3 7.4L10.7 7.4L10.65 5.8L11.3 5.75L12.85 5.4L13.35 5.15L13.5 5.1L14.5 4.4L14.8 3.6L14.9 3.5L14.8 3.45L14.8 3.25Q15.25 2.75 13.25 1.95Q11.3 1.15 10.2 1.15L8.25 1.4L14.25 3.7L14.35 3.7L14.4 3.75L14.4 3.9L14.25 4Q12.35 3.6 10.8 3L9.95 2.6L7.9 1.6L7.85 1.45L7.75 1.55Q7.35 1.6 7.1 1.8Q6.5 2.05 6.25 2.35L12.85 5L12.85 5.15L12.85 5.3L12.7 5.3L10.15 4.6Q7.85 3.75 6.1 2.6Q5.8 2.95 5.8 3.45L5.8 3.75L6.25 4.6L6.45 4.75L7.1 5.1L8.25 5.55M14.8 3.6L15 3.7L14.8 5.15Q14.8 5.9 14 6.45L13 6.95L12.25 7.2L12.2 7.2L11.45 7.4L11.2 7.4L11.05 7.8L11.55 12.05L10.4 12.95L9.05 12.4L9.25 8.1L9.15 7.4M14.25 6.9L15.5 9.35L14.25 10.5L14.15 10.5L13 10L12.5 7.8L13.25 7.6L13.35 7.7L13.35 7.6L13.25 7.6M14.9 3.5L14.9 3.45L14.9 3.35M14.25 6.9L13.35 7.6M10.7 7.4L10.95 7.2L11.2 7.4M10.2 8.3L11.05 7.8M10.15 8.3L10.2 8.75L10.2 8.3L10.15 8.3L9.25 8.1M13.35 7.7L14.15 10.5M5.8 3.75L5.8 5.15Q5.7 5.45 5.95 5.85L5.95 5.8L6 5.9L6.2 6.15L6.2 6.25L6.35 6.3L6.45 4.75M6 5.9L5.95 5.85L5.8 6.45L6.45 7.3L6.7 6.55L6.5 6.4L6.35 6.3M8.4 7.2L8.35 7.2L8.1 7.2L7.9 7.15L7.6 6.95L7.4 7.6L6.7 10.15L5.35 10.75L4.2 10.25L5.8 6.45M6.35 7.45L7.4 7.6M6.45 7.3L6.35 7.45L5.35 10.75M7.6 6.95L6.5 6.3L6.5 6.4M10.2 8.75L10.4 12.95"
          />
        </g>
      </defs>
    </svg>
  );
}

export function ButtonSitDown({ className }: IconProps) {
  const uid = useId();

  return (
    <svg
      viewBox="0 0 20 14"
      className={cn("pointer-events-none", className)}
      shapeRendering="geometricPrecision"
      imageRendering="optimizeQuality"
      role="img"
    >
      <title>Stand up</title>
      <g transform="matrix(1, 0, 0, 1, 0, 0)">
        <use
          xlinkHref={`#${uid}-o0`}
          width="20"
          height="14"
          transform="matrix(1, 0, 0, 1, 0, 0)"
        />
      </g>
      <defs>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o0`}>
          <use
            xlinkHref={`#${uid}-o1`}
            width="100"
            height="100"
            transform="matrix(0.1, 0, 0, 0.14, 5, 0)"
          />
          <use
            xlinkHref={`#${uid}-o3`}
            width="100"
            height="100"
            transform="matrix(-0.05, 0, 0, -0.05, 20, 14)"
          />
          <use
            xlinkHref={`#${uid}-o5`}
            width="100"
            height="100"
            transform="matrix(0.05, 0, 0, 0.09, 15, 0)"
          />
          <use
            xlinkHref={`#${uid}-o7`}
            width="100"
            height="100"
            transform="matrix(0.05, 0, 0, -0.05, 0, 14)"
          />
          <use
            xlinkHref={`#${uid}-o9`}
            width="100"
            height="100"
            transform="matrix(-0.05, 0, 0, 0.09, 5, 0)"
          />
          <use
            xlinkHref={`#${uid}-o11`}
            width="11.3"
            height="11.8"
            transform="matrix(1, 0, 0, 1, 4.2, 1.15)"
          />
          <use
            xlinkHref={`#${uid}-o12`}
            width="100"
            height="100"
            transform="matrix(0.12, 0, 0, 0.12, 4, 1)"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o1`}>
          <use
            xlinkHref={`#${uid}-o2`}
            width="100"
            height="100"
            transform="matrix(1, 0, 0, 1, 0, 0)"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o2`}>
          <path
            fillRule="evenodd"
            fill="#ffffff"
            stroke="#ffffff"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            d="M0 0L100 0L100 100L0 100L0 0"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o3`}>
          <use
            xlinkHref={`#${uid}-o4`}
            width="100"
            height="100"
            transform="matrix(1, 0, 0, 1, 0, 0)"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o4`}>
          <path
            fillRule="evenodd"
            fill="#ffffff"
            stroke="#ffffff"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            d="M0 99.95Q0 58.6 29.25 29.25Q58.55 0 100 0L100 100L0 100L0 99.95"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o5`}>
          <use
            xlinkHref={`#${uid}-o6`}
            width="100"
            height="100"
            transform="matrix(1, 0, 0, 1, 0, 0)"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o6`}>
          <path
            fillRule="evenodd"
            fill="#ffffff"
            stroke="#ffffff"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            d="M0 0L100 0L100 100L0 100L0 0"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o7`}>
          <use
            xlinkHref={`#${uid}-o8`}
            width="100"
            height="100"
            transform="matrix(1, 0, 0, 1, 0, 0)"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o8`}>
          <path
            fillRule="evenodd"
            fill="#ffffff"
            stroke="#ffffff"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            d="M0 99.95Q0 58.6 29.25 29.25Q58.55 0 100 0L100 100L0 100L0 99.95"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o9`}>
          <use
            xlinkHref={`#${uid}-o10`}
            width="100"
            height="100"
            transform="matrix(1, 0, 0, 1, 0, 0)"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o10`}>
          <path
            fillRule="evenodd"
            fill="#ffffff"
            stroke="#ffffff"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            d="M0 0L100 0L100 100L0 100L0 0"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, -4.2, -1.15)" id={`${uid}-o11`}>
          <path
            fillRule="evenodd"
            fill="#986b29"
            stroke="#986b29"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            d="M10.65 5.8L10.3 5.8L9.55 5.75L9.5 5.75L8.25 5.55L7.1 5.1L6.45 4.75L6.25 4.6L5.8 3.75L5.8 3.45Q5.8 2.95 6.1 2.6Q7.85 3.75 10.15 4.6L12.7 5.3L12.85 5.3L12.85 5.15L12.85 5L6.25 2.35Q6.5 2.05 7.1 1.8Q7.35 1.6 7.75 1.55L7.85 1.45L7.9 1.6L9.95 2.6L10.8 3Q12.35 3.6 14.25 4L14.4 3.9L14.4 3.75L14.35 3.7L14.25 3.7L8.25 1.4L10.2 1.15Q11.3 1.15 13.25 1.95Q15.25 2.75 14.8 3.25L14.8 3.45L14.9 3.5L14.8 3.6L14.5 4.4L13.5 5.1L13.35 5.15L12.85 5.4L11.3 5.75L10.65 5.8M14.15 10.5L13 10L12.5 7.8L13.25 7.6L13.35 7.7L13.25 7.6L13.35 7.6L13.35 7.7L14.15 10.5M10.4 12.95L9.05 12.4L9.25 8.1L10.15 8.3L10.2 8.75L10.15 8.3L10.2 8.3L10.2 8.75L10.4 12.95M5.8 6.45L6.45 7.3L6.35 7.45L5.35 10.75L4.2 10.25L5.8 6.45"
          />
          <path
            fillRule="evenodd"
            fill="#715120"
            stroke="#715120"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            d="M8.25 5.55L9.5 5.75L9.55 5.75L10.3 5.8L10.65 5.8L10.7 7.4L10.3 7.4L10.05 7.45L9.15 7.4L8.8 7.4L8.4 7.2L8.25 5.55"
          />
          <path
            fillRule="evenodd"
            fill="#5b411a"
            stroke="#5b411a"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            d="M10.65 5.8L11.3 5.75L12.85 5.4L13.35 5.15L13.5 5.1L14.5 4.4L14.8 3.6L15 3.7L14.8 5.15Q14.8 5.9 14 6.45L13 6.95L12.25 7.2L12.2 7.2L11.45 7.4L11.2 7.4L10.95 7.2L10.7 7.4L10.65 5.8"
          />
          <path
            fillRule="evenodd"
            fill="#d8a738"
            stroke="#d8a738"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            d="M14.9 3.5L14.8 3.45L14.8 3.25L14.9 3.35L14.9 3.45L14.9 3.5"
          />
          <path
            fillRule="evenodd"
            fill="#6f4f1e"
            stroke="#6f4f1e"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            d="M8.25 1.4L14.25 3.7L14.35 3.7L14.4 3.75L14.4 3.9L14.25 4Q12.35 3.6 10.8 3L9.95 2.6L7.9 1.6L7.85 1.45L7.85 1.4L7.9 1.3L8.1 1.3L8.25 1.4M6.25 2.35L12.85 5L12.85 5.15L12.85 5.3L12.7 5.3L10.15 4.6Q7.85 3.75 6.1 2.6L6.1 2.55L6.1 2.45L6.1 2.35L6.25 2.35M9.15 7.4L10.05 7.45L10.15 8.3L9.25 8.1L9.15 7.4M12.5 7.8L12.25 7.2L13 6.95L13.25 7.6L12.5 7.8M5.95 5.85L6 5.9L5.95 5.85L5.8 6.45L6.45 7.3L6.7 6.55L6.5 6.4L6.35 6.3L6.2 6.25L6.2 6.15L6 5.9L5.95 5.8L5.95 5.85"
          />
          <path
            fillRule="evenodd"
            fill="#916728"
            stroke="#916728"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            d="M5.8 3.75L6.25 4.6L6.45 4.75L6.35 6.3L6.2 6.25L6.2 6.15L6 5.9L5.95 5.8L5.95 5.85Q5.7 5.45 5.8 5.15L5.8 3.75"
          />
          <path
            fillRule="evenodd"
            fill="#72511f"
            stroke="#72511f"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            d="M6.45 4.75L7.1 5.1L8.25 5.55L8.4 7.2L8.35 7.2L8.1 7.2L7.9 7.15L7.6 6.95L6.5 6.3L6.5 6.4L6.35 6.3L6.45 4.75M14.25 6.9L15.5 9.35L14.25 10.5L14.15 10.5L13.35 7.7L13.35 7.6L14.25 6.9M11.05 7.8L11.55 12.05L10.4 12.95L10.2 8.75L10.2 8.3L11.05 7.8M7.4 7.6L6.7 10.15L5.35 10.75L6.35 7.45L7.4 7.6"
          />
          <path
            fillRule="evenodd"
            fill="#493414"
            stroke="#493414"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            d="M10.05 7.45L10.3 7.4L10.7 7.4L10.95 7.2L11.2 7.4L11.05 7.8L10.2 8.3L10.15 8.3L10.05 7.45M14 6.45L14.25 6.9L13.35 7.6L13.25 7.6L13 6.95L14 6.45M6.45 7.3L6.7 6.55L6.5 6.4L6.5 6.3L7.6 6.95L7.4 7.6L6.35 7.45L6.45 7.3"
          />
          <path
            fill="none"
            stroke="#603c0f"
            strokeOpacity="0.61960784313725"
            vectorEffect="non-scaling-stroke"
            strokeWidth="1"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8.25 5.55L9.5 5.75L9.55 5.75L10.3 5.8L10.65 5.8L11.3 5.75L12.85 5.4L13.35 5.15L13.5 5.1L14.5 4.4L14.8 3.6L14.9 3.5L14.8 3.45L14.8 3.25Q15.25 2.75 13.25 1.95Q11.3 1.15 10.2 1.15L8.25 1.4L14.25 3.7L14.35 3.7L14.4 3.75L14.4 3.9L14.25 4Q12.35 3.6 10.8 3L9.95 2.6L7.9 1.6L7.85 1.45L7.75 1.55Q7.35 1.6 7.1 1.8Q6.5 2.05 6.25 2.35L12.85 5L12.85 5.15L12.85 5.3L12.7 5.3L10.15 4.6Q7.85 3.75 6.1 2.6Q5.8 2.95 5.8 3.45L5.8 3.75L6.25 4.6L6.45 4.75L7.1 5.1L8.25 5.55L8.4 7.2L8.8 7.4L9.15 7.4L10.05 7.45L10.3 7.4L10.7 7.4L10.65 5.8M14 6.45Q14.8 5.9 14.8 5.15L15 3.7L14.8 3.6M14.9 3.35L14.9 3.45L14.9 3.5M14.25 6.9L15.5 9.35L14.25 10.5L14.15 10.5L13 10L12.5 7.8L13.25 7.6L13.35 7.7L13.35 7.6L13.25 7.6M12.25 7.2L12.2 7.2L11.45 7.4L11.2 7.4L11.05 7.8L11.55 12.05L10.4 12.95L9.05 12.4L9.25 8.1L9.15 7.4M13 6.95L14 6.45M13 6.95L12.25 7.2M14.25 6.9L13.35 7.6M10.7 7.4L10.95 7.2L11.2 7.4M10.2 8.75L10.15 8.3L9.25 8.1M10.2 8.3L10.2 8.75L10.4 12.95M10.2 8.3L11.05 7.8M10.15 8.3L10.2 8.3M13.35 7.7L14.15 10.5M6 5.9L5.95 5.85L5.8 6.45L6.45 7.3L6.7 6.55L6.5 6.4L6.35 6.3L6.2 6.25L6.2 6.15L6 5.9L5.95 5.8L5.95 5.85Q5.7 5.45 5.8 5.15L5.8 3.75M8.4 7.2L8.35 7.2L8.1 7.2L7.9 7.15L7.6 6.95L7.4 7.6L6.7 10.15L5.35 10.75L4.2 10.25L5.8 6.45M6.35 7.45L7.4 7.6M6.45 7.3L6.35 7.45L5.35 10.75M6.5 6.4L6.5 6.3L7.6 6.95M6.35 6.3L6.45 4.75"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o12`}>
          <use
            xlinkHref={`#${uid}-o13`}
            width="100"
            height="100"
            transform="matrix(1, 0, 0, 1, 0, 0)"
          />
        </g>
        <g transform="matrix(1, 0, 0, 1, 0, 0)" id={`${uid}-o13`}>
          <path
            fillRule="evenodd"
            fill="#ffffff"
            fillOpacity="0.49803921568627"
            stroke="#ffffff"
            strokeOpacity="0.49803921568627"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            d="M0 0L100 0L100 100L0 100L0 0"
          />
        </g>
      </defs>
    </svg>
  );
}
