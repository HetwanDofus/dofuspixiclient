"use client";

import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const ARROW_PATHS = {
  up: "M6 4 L8.5 8 L3.5 8 Z",
  down: "M6 8 L8.5 4 L3.5 4 Z",
  left: "M4 6 L8 3.5 L8 8.5 Z",
  right: "M8 6 L4 3.5 L4 8.5 Z",
} as const;

type ArrowDirection = keyof typeof ARROW_PATHS;

function ScrollbarArrow({
  direction,
  onClick,
}: {
  direction: ArrowDirection;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Scroll ${direction}`}
      className={cn(
        "block shrink-0 cursor-pointer border-none bg-[#beb998] p-0",
        "w-[calc(12px*var(--resolution-factor))]",
        "h-[calc(12px*var(--resolution-factor))]"
      )}
    >
      <svg
        viewBox="0 0 12 12"
        className="w-full h-full"
        fill="#514a3c"
        shapeRendering="geometricPrecision"
        role="img"
      >
        <title>{`Scroll ${direction}`}</title>
        <path d={ARROW_PATHS[direction]} />
      </svg>
    </button>
  );
}

const scrollbarVariants = cva("flex bg-[#beb998]", {
  variants: {
    axis: {
      vertical: "flex-col w-[calc(12px*var(--resolution-factor))]",
      horizontal: "flex-row h-[calc(12px*var(--resolution-factor))]",
    },
  },
  defaultVariants: { axis: "vertical" },
});

interface ScrollbarProps extends VariantProps<typeof scrollbarVariants> {
  className?: string;
  onScrollStart?: () => void;
  onScrollEnd?: () => void;
}

function Scrollbar({
  axis = "vertical",
  className,
  onScrollStart,
  onScrollEnd,
}: ScrollbarProps) {
  const isVertical = axis === "vertical";

  return (
    <div className={cn(scrollbarVariants({ axis }), className)}>
      <ScrollbarArrow
        direction={isVertical ? "up" : "left"}
        onClick={onScrollStart}
      />
      <div className="relative flex-1">
        <div
          className={cn(
            "absolute flex",
            isVertical
              ? [
                  "inset-y-0 flex-col",
                  "left-[calc(1px*var(--resolution-factor))]",
                  "right-[calc(1px*var(--resolution-factor))]",
                ]
              : [
                  "inset-x-0 flex-row",
                  "top-[calc(1px*var(--resolution-factor))]",
                  "bottom-[calc(1px*var(--resolution-factor))]",
                ]
          )}
        >
          <div
            className={cn(
              "bg-[#514a3c]",
              isVertical
                ? [
                    "h-[calc(1px*var(--resolution-factor))]",
                    "mx-[calc(1px*var(--resolution-factor))]",
                  ]
                : [
                    "w-[calc(1px*var(--resolution-factor))]",
                    "my-[calc(1px*var(--resolution-factor))]",
                  ]
            )}
          />
          <div className="flex-1 bg-[#514a3c]" />
          <div
            className={cn(
              "bg-[#514a3c]",
              isVertical
                ? [
                    "h-[calc(1px*var(--resolution-factor))]",
                    "mx-[calc(1px*var(--resolution-factor))]",
                  ]
                : [
                    "w-[calc(1px*var(--resolution-factor))]",
                    "my-[calc(1px*var(--resolution-factor))]",
                  ]
            )}
          />
        </div>
      </div>
      <ScrollbarArrow
        direction={isVertical ? "down" : "right"}
        onClick={onScrollEnd}
      />
    </div>
  );
}

export { Scrollbar };
