import { useId } from "react";

export function ButtonBgUp({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      overflow="visible"
      fill="none"
      shapeRendering="geometricPrecision"
      imageRendering="optimizeQuality"
    >
      <title>Button</title>
      <circle cx="12" cy="12" r="12" fill="#b14f00" />
      <circle cx="12" cy="12" r="11" fill={`url(#${id})`} />
      <defs>
        <radialGradient
          id={id}
          gradientTransform="matrix(0.012, 0, 0, 0.012, 8, 6.9)"
          gradientUnits="userSpaceOnUse"
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

export function ButtonBgDown({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      overflow="visible"
      fill="none"
      shapeRendering="geometricPrecision"
      imageRendering="optimizeQuality"
    >
      <title>Button pressed</title>
      <circle cx="12" cy="12" r="12" fill="#b14f00" />
      <circle cx="12" cy="12" r="11" fill={`url(#${id})`} />
      <defs>
        <radialGradient
          id={id}
          gradientTransform="matrix(-0.012, 0, 0, -0.012, 16, 17.1)"
          gradientUnits="userSpaceOnUse"
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
