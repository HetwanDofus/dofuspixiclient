import type { ReactNode } from "react";

interface SlotGridProps {
  columns: number;
  slotSize?: number;
  gap?: number;
  children: ReactNode;
}

export function SlotGrid({ columns, slotSize = 36, gap = 2, children }: SlotGridProps) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${columns}, ${slotSize}px)`,
        gap,
        padding: 4,
      }}
    >
      {children}
    </div>
  );
}

interface SlotProps {
  size?: number;
  active?: boolean;
  children?: ReactNode;
  onClick?: () => void;
}

export function Slot({ size = 36, active, children, onClick }: SlotProps) {
  return (
    <div
      className={`dofus-slot${active ? " dofus-slot--active" : ""}`}
      style={{ width: size, height: size }}
      onClick={onClick}
    >
      {children}

      <style>{`
        .dofus-slot {
          background: var(--dofus-slot-bg, #dcd5bf);
          border: 1px solid var(--dofus-border, #4e4028);
          border-radius: 2px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          position: relative;
        }
        .dofus-slot:hover {
          filter: brightness(1.1);
        }
        .dofus-slot--active {
          border-color: var(--dofus-boost, #ff6100);
          box-shadow: 0 0 4px var(--dofus-boost, #ff6100);
        }
      `}</style>
    </div>
  );
}
