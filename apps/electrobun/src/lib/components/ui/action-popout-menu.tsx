"use client";

import type * as React from "react";
import { ContextMenu } from "@base-ui/react/context-menu";

import { cn } from "@/lib/utils";

function ActionPopoutMenu({ children, ...props }: ContextMenu.Root.Props) {
  return <ContextMenu.Root {...props}>{children}</ContextMenu.Root>;
}

function ActionPopoutMenuTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <ContextMenu.Trigger
      render={<div className={cn("inline-block", className)} {...props} />}
    >
      {children}
    </ContextMenu.Trigger>
  );
}

function ActionPopoutMenuContent({
  className,
  children,
  sideOffset = 0,
}: {
  className?: string;
  children?: React.ReactNode;
  sideOffset?: number;
}) {
  return (
    <ContextMenu.Portal>
      <ContextMenu.Positioner sideOffset={sideOffset}>
        <ContextMenu.Popup
          className={cn(
            "z-1000 outline-none font-bitmini6 border-0",
            "max-w-[calc(166px*var(--resolution-factor))]",
            "text-[calc(8px*var(--resolution-factor))]",
            "shadow-[0_0_0_calc(1px*var(--resolution-factor))_var(--action-popout-menu-bg),0_0_0_calc(2px*var(--resolution-factor))_var(--action-popout-menu-border)]",
            "bg-action-popout-menu-fg",
            className
          )}
        >
          {children}
        </ContextMenu.Popup>
      </ContextMenu.Positioner>
    </ContextMenu.Portal>
  );
}

function ActionPopoutMenuHeader({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex items-center select-none",
        "h-[calc(18px*var(--resolution-factor))]",
        "pl-[calc(2px*var(--resolution-factor))]",
        "pr-[calc(16px*var(--resolution-factor))]",
        "bg-action-popout-menu-static-bg text-action-popout-menu-static-text font-normal",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

function ActionPopoutMenuItem({
  className,
  children,
  ...props
}: {
  className?: string;
  children?: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <ContextMenu.Item
      className={cn(
        "flex cursor-pointer items-center select-none outline-none",
        "h-[calc(18px*var(--resolution-factor))]",
        "pl-[calc(2px*var(--resolution-factor))]",
        "pr-[calc(16px*var(--resolution-factor))]",
        "bg-action-popout-menu-fg text-action-popout-menu-item-text font-normal",
        "hover:bg-action-popout-menu-item-hover data-highlighted:bg-action-popout-menu-item-hover",
        className
      )}
      {...props}
    >
      {children}
    </ContextMenu.Item>
  );
}

function ActionPopoutMenuSeparator({ className }: { className?: string }) {
  return (
    <ContextMenu.Separator
      className={cn("h-px bg-action-popout-menu-bg", className)}
    />
  );
}

export {
  ActionPopoutMenu,
  ActionPopoutMenuContent,
  ActionPopoutMenuHeader,
  ActionPopoutMenuItem,
  ActionPopoutMenuSeparator,
  ActionPopoutMenuTrigger,
};
