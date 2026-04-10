import type { ReactNode } from "react";

interface SectionHeaderProps {
  children: ReactNode;
}

export function SectionHeader({ children }: SectionHeaderProps) {
  return (
    <div
      style={{
        background: "var(--dofus-header-bg, #514a3c)",
        color: "var(--dofus-text-white, #ffffff)",
        padding: "3px 8px",
        fontSize: 10,
        fontWeight: "bold",
      }}
    >
      {children}
    </div>
  );
}
