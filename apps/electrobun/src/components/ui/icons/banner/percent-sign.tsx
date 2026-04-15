"use client";

export function PercentSign({
  className,
  transform,
}: {
  className?: string;
  transform?: string;
}) {
  return (
    <g
      className={className}
      transform={transform}
      shapeRendering="geometricPrecision"
      imageRendering="optimizeQuality"
    >
      <path
        fill="#000033"
        d="M2.3 3.4L-1.4 13.25L-2.3 13.25L1.4 3.4L2.3 3.4M3.8 8.75L3.95 9.75L3.95 11.4L3.85 12.35L3.3 12.9L2.25 13.15L1.15 12.9L0.6 12.4L0.45 11.45L0.45 9.75Q0.45 9.05 0.6 8.75Q0.75 8.4 1.15 8.2L2.15 7.95L3.25 8.2L3.8 8.75M2.2 8.8Q2.05 8.8 2 8.9L1.95 9.35L1.95 11.75L2 12.25L2.2 12.3L2.4 12.2L2.45 11.8L2.45 9.35L2.4 8.9Q2.4 8.8 2.2 8.8M-3.25 3.6L-2.25 3.4L-1.15 3.6L-0.6 4.15Q-0.45 4.5 -0.45 5.2L-0.45 6.8L-0.55 7.75L-1.1 8.35L-2.15 8.55L-3.25 8.35L-3.8 7.8L-3.95 6.9L-3.95 5.2L-3.8 4.15L-3.25 3.6M-2.45 4.75L-2.45 7.15L-2.4 7.65L-2.2 7.75L-2 7.65L-1.95 7.2L-1.95 4.75L-2 4.3Q-2 4.2 -2.2 4.2L-2.4 4.3L-2.45 4.75"
      />
    </g>
  );
}
