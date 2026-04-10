import { useCallback, useState } from "react";

import Loader from "@/components/Loader";
import MapRenderer from "@/components/MapRenderer";
import { classicTheme } from "@/themes/classic";
import { ThemeProvider } from "@/themes/ThemeProvider";

export default function App() {
  const [loading, setLoading] = useState(true);
  const [fadeOut, setFadeOut] = useState(false);
  const [loadingPercent, setLoadingPercent] = useState(0);
  const [loadingLabel, setLoadingLabel] = useState("Initializing...");

  const handleProgress = useCallback((percent: number, label: string) => {
    setLoadingPercent(percent);
    setLoadingLabel(label);
  }, []);

  const handleReady = useCallback(() => {
    setFadeOut(true);
    setTimeout(() => setLoading(false), 400);
  }, []);

  return (
    <ThemeProvider theme={classicTheme}>
    <main
      style={{
        width: "100%",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "linear-gradient(135deg, #1e1e1e 0%, #2a2a2a 100%)",
        position: "relative",
      }}
    >
      {loading && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 9999,
            opacity: fadeOut ? 0 : 1,
            transition: "opacity 0.4s ease",
            pointerEvents: fadeOut ? "none" : "auto",
          }}
        >
          <Loader percent={loadingPercent} label={loadingLabel} />
        </div>
      )}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          visibility: !fadeOut && loading ? "hidden" : "visible",
        }}
      >
        <MapRenderer onReady={handleReady} onProgress={handleProgress} />
      </div>
    </main>
    </ThemeProvider>
  );
}
