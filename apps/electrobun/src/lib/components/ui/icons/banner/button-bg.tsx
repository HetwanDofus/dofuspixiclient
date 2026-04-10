import { useId } from "react";

export function ButtonBgUp({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg
      className={className}
      viewBox="0 0 26 26"
      fill="none"
      shapeRendering="geometricPrecision"
      imageRendering="optimizeQuality"
    >
      <title>Button</title>
      <circle cx="13" cy="13" r="13" fill="#b14f00" />
      <circle cx="13" cy="13" r="12" fill={`url(#${id})`} />
      <defs>
        <radialGradient
          id={id}
          gradientTransform="matrix(0.012, 0, 0, 0.012, 9, 7.9)"
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
      viewBox="0 0 26 26"
      fill="none"
      shapeRendering="geometricPrecision"
      imageRendering="optimizeQuality"
    >
      <title>Button pressed</title>
      <circle cx="13" cy="13" r="13" fill="#b14f00" />
      <circle cx="13" cy="13" r="12" fill={`url(#${id})`} />
      <defs>
        <radialGradient
          id={id}
          gradientTransform="matrix(-0.012, 0, 0, -0.012, 17, 18.1)"
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
