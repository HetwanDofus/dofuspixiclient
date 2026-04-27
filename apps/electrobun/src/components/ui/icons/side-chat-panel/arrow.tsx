import type * as React from "react";
import { useId } from "react";

import { cn } from "@/lib/utils";

type ArrowDirection = "left" | "right";

interface SideChatArrowIconProps extends React.SVGProps<SVGSVGElement> {
  direction: ArrowDirection;
}

function SideChatArrowIcon({
  direction,
  className,
  style,
  ...props
}: SideChatArrowIconProps) {
  const gradId = useId();

  return (
    <svg
      viewBox="0 0 30 30"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("w-5.25 h-5.25", className)}
      role="img"
      aria-label={`Move ${direction}`}
      style={{
        ...(direction === "left" ? { transform: "scaleX(-1)" } : null),
        ...style,
      }}
      {...props}
    >
      <title>{`Move ${direction}`}</title>
      <defs>
        <linearGradient
          id={gradId}
          x1="13"
          y1="11"
          x2="23"
          y2="21"
          gradientUnits="userSpaceOnUse"
        >
          <stop
            offset="0"
            stopColor="var(--color-side-chat-arrow-gradient-start)"
          />
          <stop
            offset="1"
            stopColor="var(--color-side-chat-arrow-gradient-end)"
          />
        </linearGradient>
      </defs>
      <path
        fill="var(--color-side-chat-arrow-outline)"
        d="m12.5 2.5625c-1.031 0.0971-1.817 0.9647-1.812 2v2.625h-7.313c-1.1045 0.0001-1.9999 0.8955-2 2v11.624c0.0001 1.105 0.8955 2 2 2h7.313v2.626c0 1.104 0.895 1.999 2 2h2.312c0.454 0 0.895-0.154 1.25-0.438l11.625-9.281c0.474-0.38 0.75-0.955 0.75-1.563v-2.312c0-0.608-0.276-1.183-0.75-1.563l-11.625-9.281c-0.355-0.2835-0.796-0.4378-1.25-0.4375h-2.312c-0.063-0.0029-0.126-0.0029-0.188 0z"
      />
      <path
        fill={`url(#${gradId})`}
        d="m13.312 5.1875v4c0 0.3452-0.279 0.625-0.624 0.625h-8.688v10.376h8.688c0.345 0 0.624 0.279 0.624 0.624v4h1.469l11.219-8.968v-1.688l-11.219-8.9685h-1.469z"
      />
    </svg>
  );
}

export type { ArrowDirection as SideChatArrowDirection };
export { SideChatArrowIcon };
