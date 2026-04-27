"use client";

type TimelinePipProps = {
  className?: string;
  team?: "ally" | "enemy";
  active?: boolean;
  dead?: boolean;
};

export function TimelinePip({
  className,
  team = "ally",
  active = false,
  dead = false,
}: TimelinePipProps) {
  const fill =
    team === "ally"
      ? "var(--color-dofus-team-blue, #0000ff)"
      : "var(--color-dofus-team-red, #ff0000)";
  const opacity = dead ? 0.3 : 1;
  return (
    <svg
      overflow="visible"
      viewBox="0 0 24 28"
      xmlns="http://www.w3.org/2000/svg"
      width="24px"
      height="28px"
      className={className}
      shapeRendering="geometricPrecision"
    >
      <title>Turn slot</title>
      <g opacity={opacity}>
        <rect
          x="1.5"
          y="1.5"
          width="21"
          height="25"
          rx="2"
          fill={fill}
          stroke={active ? "#ffffff" : "#402b15"}
          strokeWidth={active ? 2 : 1}
        />
        {dead && (
          <path
            stroke="#ffffff"
            strokeWidth="2"
            strokeLinecap="round"
            d="M6 6 L18 22 M18 6 L6 22"
          />
        )}
      </g>
    </svg>
  );
}
