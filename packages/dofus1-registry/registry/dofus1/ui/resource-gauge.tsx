"use client";

import type { ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { match } from "ts-pattern";

import { cn } from "@/lib/utils";

import { AP } from "./icons/fight/ap";
import { HP } from "./icons/fight/hp";
import { MP } from "./icons/fight/mp";

const gaugeVariants = cva(
  [
    "inline-flex items-center gap-[calc(3px*var(--resolution-factor))]",
    "h-[calc(18px*var(--resolution-factor))]",
    "px-[calc(4px*var(--resolution-factor))]",
    "rounded-[calc(3px*var(--resolution-factor))]",
    "border-[calc(1px*var(--resolution-factor))]",
    "bg-[#1a1610] text-white font-[Verdana,sans-serif] font-bold",
    "text-[calc(9px*var(--resolution-factor))]",
  ],
  {
    variants: {
      variant: {
        hp: "border-[var(--dofus-hp-red)] text-[var(--dofus-hp-red)]",
        ap: "border-[var(--dofus-ap-blue)] text-[var(--dofus-ap-blue)]",
        mp: "border-[var(--dofus-mp-green)] text-[var(--dofus-mp-green)]",
      },
    },
    defaultVariants: { variant: "hp" },
  },
);

interface ResourceGaugeProps extends VariantProps<typeof gaugeVariants> {
  value: number;
  max?: number;
  className?: string;
  icon?: ReactNode;
}

const iconFor = (v: ResourceGaugeProps["variant"]) =>
  match(v)
    .with("ap", () => <AP />)
    .with("mp", () => <MP />)
    .with("hp", () => <HP />)
    .otherwise(() => null);

function ResourceGauge({
  variant,
  value,
  max,
  className,
  icon,
}: ResourceGaugeProps) {
  return (
    <div className={cn(gaugeVariants({ variant }), className)}>
      <span className="inline-flex h-[calc(14px*var(--resolution-factor))] w-[calc(14px*var(--resolution-factor))] items-center justify-center">
        {icon ?? iconFor(variant)}
      </span>
      <span className="tabular-nums">
        {value}
        {max !== undefined && (
          <>
            <span className="text-[#8a8060]">/</span>
            {max}
          </>
        )}
      </span>
    </div>
  );
}

export { ResourceGauge, gaugeVariants };
export type { ResourceGaugeProps };
