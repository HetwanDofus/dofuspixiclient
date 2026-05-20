import { setTransportFactory } from "@dofus/dofus1-net";
import { useCallback, useEffect, useRef, useState } from "react";

import { initRpcTransport, openRpcSocket } from "@/game/net/rpc-transport";
import { GameSession } from "@/game/session";
import { classicTheme } from "@/themes/classic";
import { ThemeProvider } from "@/themes/ThemeProvider";

import { AuthFlow } from "./auth/AuthFlow";
import { Loader } from "./Loader";
import { MapRenderer } from "./MapRenderer";

// AraknemuHorizon defaults — the emulator binds the auth socket on
// `localhost:5555` (canonical 1.29). Override via env-driven config
// once the dev-shell exposes it.
const AUTH_HOST = "127.0.0.1";
const AUTH_PORT = 4444;
// AraknemuHorizon's `config.conf` ships `client.version = "1.43.7"`
// by default. Match it here or edit `config.conf` so the two agree —
// otherwise the server replies `AlEv<expected>` and closes the
// socket before the credentials packet is even processed.
const CLIENT_VERSION = "1.43.7";
const LANGUAGE = "en";

// CEF / Chromium can't open raw TCP. Route every dofus1-net socket
// through electrobun's RPC bridge to the Bun main process — where
// `Bun.connect` lives. Runs once at module load (idempotent).
initRpcTransport();
setTransportFactory(openRpcSocket);

export function App() {
  // Single GameSession shared across AuthFlow (pre-game) and
  // MapRenderer (in-game). Lifting it here keeps the authenticated TCP
  // session alive across the AuthFlow → MapRenderer swap.
  const sessionRef = useRef<GameSession | null>(null);
  if (!sessionRef.current) {
    sessionRef.current = new GameSession({
      authHost: AUTH_HOST,
      authPort: AUTH_PORT,
      clientVersion: CLIENT_VERSION,
      language: LANGUAGE,
    });
  }
  const session = sessionRef.current;

  useEffect(() => {
    return () => {
      sessionRef.current?.destroy();
      sessionRef.current = null;
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
              client={session}
              onReady={handleReady}
              onProgress={handleProgress}
            />
          ) : (
            <AuthFlow client={session} onEnterGame={handleEnterGame} />
          )}
        </div>
      </main>
    </ThemeProvider>
  );
}
