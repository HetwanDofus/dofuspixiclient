import { useEffect, useSyncExternalStore } from "react";
import { contextMenuStore, hideContextMenu } from "@/stores/context-menu-store";
import { cn } from "@/lib/utils";

export function GameContextMenu() {
  const { open, title, options, x, y } = useSyncExternalStore(
    contextMenuStore.subscribe,
    contextMenuStore.getSnapshot
  );

  useEffect(() => {
    if (!open) return;
    const handleClick = () => hideContextMenu();
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hideContextMenu();
    };
    // Defer so the opening click doesn't immediately close the menu
    const raf = requestAnimationFrame(() => {
      window.addEventListener("pointerdown", handleClick);
      window.addEventListener("keydown", handleKey);
    });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointerdown", handleClick);
      window.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className={cn(
        "fixed z-[1000] font-bitmini6 border-0",
        "max-w-[calc(166px*var(--resolution-factor))]",
        "text-[calc(8px*var(--resolution-factor))]",
        "shadow-[0_0_0_calc(1px*var(--resolution-factor))_var(--action-popout-menu-bg),0_0_0_calc(2px*var(--resolution-factor))_var(--action-popout-menu-border)]",
        "bg-action-popout-menu-fg"
      )}
      style={{ left: x, top: y }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        className={cn(
          "flex items-center select-none",
          "h-[calc(18px*var(--resolution-factor))]",
          "pl-[calc(2px*var(--resolution-factor))]",
          "pr-[calc(16px*var(--resolution-factor))]",
          "bg-action-popout-menu-static-bg text-action-popout-menu-static-text font-normal"
        )}
      >
        {title}
      </div>
      {options.map((opt) => (
        <div
          key={opt.label}
          className={cn(
            "flex cursor-pointer items-center select-none",
            "h-[calc(18px*var(--resolution-factor))]",
            "pl-[calc(2px*var(--resolution-factor))]",
            "pr-[calc(16px*var(--resolution-factor))]",
            "bg-action-popout-menu-fg text-action-popout-menu-item-text font-normal",
            "hover:bg-action-popout-menu-item-hover"
          )}
          onPointerDown={(e) => {
            e.stopPropagation();
            opt.onClick();
            hideContextMenu();
          }}
        >
          {opt.label}
        </div>
      ))}
    </div>
  );
}
