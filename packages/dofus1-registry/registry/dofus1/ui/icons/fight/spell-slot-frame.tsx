"use client";

type SpellSlotFrameProps = {
  className?: string;
  state?: "ready" | "disabled" | "selected" | "cooldown";
};

export function SpellSlotFrame({
  className,
  state = "ready",
}: SpellSlotFrameProps) {
  const borderColor =
    state === "selected"
      ? "#ffd44a"
      : state === "disabled"
        ? "#5a5245"
        : "#d5cfaa";
  const borderWidth = state === "selected" ? 2 : 1.5;
  return (
    <svg
      overflow="visible"
      viewBox="0 0 40 40"
      xmlns="http://www.w3.org/2000/svg"
      width="40px"
      height="40px"
      className={className}
      shapeRendering="geometricPrecision"
    >
      <title>Spell slot</title>
      <rect
        x={borderWidth / 2}
        y={borderWidth / 2}
        width={40 - borderWidth}
        height={40 - borderWidth}
        rx="3"
        fill="#1a1610"
        stroke={borderColor}
        strokeWidth={borderWidth}
      />
    </svg>
  );
}
