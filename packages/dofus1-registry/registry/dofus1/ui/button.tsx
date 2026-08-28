import type * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  [
    "inline-flex cursor-pointer items-center justify-center select-none outline-none font-[Verdana,sans-serif]",
    "h-[calc(18px*var(--resolution-factor))]",
    "text-[calc(8px*var(--resolution-factor))]",
    "border-[calc(1px*var(--resolution-factor))]",
    "bg-button-bg bg-[linear-gradient(to_bottom,transparent_50%,rgba(0,0,0,0.2)_100%)] text-white",
    "shadow-[inset_0_calc(1px*var(--resolution-factor))_0_0_var(--button-highlight)]",
    "active:bg-button-bg-active",
    "active:shadow-[inset_0_calc(-1px*var(--resolution-factor))_0_0_var(--button-highlight-active)]",
    "disabled:pointer-events-none disabled:opacity-70",
  ],
  {
    variants: {
      variant: {
        pill: "rounded-[calc(9px*var(--resolution-factor))] px-[calc(9px*var(--resolution-factor))]",
        rectangle:
          "rounded-[calc(4px*var(--resolution-factor))] px-[calc(4px*var(--resolution-factor))]",
      },
      borderColor: {
        brown: "border-button-border active:border-button-border-active",
        white:
          "border-button-white-border active:border-button-white-border-active",
      },
    },
    defaultVariants: {
      variant: "pill",
      borderColor: "brown",
    },
  },
);

interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

function Button({
  className,
  variant,
  borderColor,
  asChild = false,
  children,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      className={cn(buttonVariants({ variant, borderColor, className }))}
      {...props}
    >
      {children}
    </Comp>
  );
}

export { Button, buttonVariants };
export type { ButtonProps };
