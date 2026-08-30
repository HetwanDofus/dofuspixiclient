"use client";

import { Settings } from "lucide-react";
import { useEffect, useState } from "react";

import { Card, CardContent } from "@/components/ui/card";

export function PreviewCard({ className, children }: { className?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [scale, setScale] = useState<number | null>(null);

  useEffect(() => {
    if (scale !== null) {
      document.documentElement.style.setProperty(
        "--resolution-factor",
        String(scale)
      );
    } else {
      document.documentElement.style.removeProperty("--resolution-factor");
    }
    return () => {
      document.documentElement.style.removeProperty("--resolution-factor");
    };
  }, [scale]);

  return (
    <Card className="mb-6 relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="absolute top-3 right-3 z-10 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
      >
        <Settings className="size-4" />
      </button>

      {open && (
        <div className="absolute top-11 right-3 z-10 bg-card border border-border rounded-lg p-3 shadow-lg w-52">
          <label className="text-xs text-muted-foreground block mb-2">
            Resolution: {scale === null ? "auto" : `${scale.toFixed(1)}x`}
          </label>
          <input
            type="range"
            min="1"
            max="10"
            step="0.5"
            value={scale ?? 1}
            onChange={(e) => setScale(Number(e.target.value))}
            className="w-full accent-primary"
          />
          {scale !== null && (
            <button
              type="button"
              onClick={() => setScale(null)}
              className="text-xs text-muted-foreground hover:text-foreground mt-1 cursor-pointer"
            >
              Reset to auto
            </button>
          )}
        </div>
      )}

      <CardContent className={`flex items-center justify-center min-h-48 p-10 pt-48 overflow-auto ${className ?? ""}`}>
        {children}
      </CardContent>
    </Card>
  );
}
