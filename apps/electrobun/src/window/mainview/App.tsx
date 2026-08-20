import { useCallback, useEffect, useRef, useState } from "react";

import { GameClient } from "@/game/game-client";
import { classicTheme } from "@/themes/classic";
import { ThemeProvider } from "@/themes/ThemeProvider";

import { AuthFlow } from "./auth/AuthFlow";
import { ConnectionLostDialog } from "./ConnectionLostDialog";
import { Loader } from "./Loader";
import { MapRenderer } from "./MapRenderer";

export function App() {
  // Single GameClient shared across AuthFlow (pre-game) and MapRenderer
  // (in-game). Lifting the client here keeps the authenticated WebSocket
  // session alive across the AuthFlow → MapRenderer swap.
  const clientRef = useRef<GameClient | null>(null);
  if (!clientRef.current) {
    clientRef.current = new GameClient({ serverUrl: "ws://localhost:8080/auth" });
    clientRef.current.connect();
  }
  const client = clientRef.current;

  useEffect(() => {
    return () => {
      clientRef.current?.destroy();
      clientRef.current = null;
    };
  }, []);

  const [inGame, setInGame] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fadeOut, setFadeOut] = useState(false);
  const [loadingPercent, setLoadingPercent] = useState(0);
  const [loadingLabel, setLoadingLabel] = useState("Initializing...");

  const handleEnterGame = useCallback(() => {
    setInGame(true);
    setLoading(true);
  }, []);

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
          {inGame ? (
            <MapRenderer
              client={client}
              onReady={handleReady}
              onProgress={handleProgress}
            />
          ) : (
            <AuthFlow client={client} onEnterGame={handleEnterGame} />
          )}
        </div>

        {/*
          Outside the loader/auth/game switch on purpose: the link can die at
          any point in the session, and the player has to be told wherever they
          happen to be (QA-046).
        */}
        <ConnectionLostDialog />
      </main>
    </ThemeProvider>
  );
}
