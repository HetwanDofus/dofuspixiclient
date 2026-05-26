import {
  makeWebSocketFactory,
  setTransportFactory,
} from "@dofus/dofus1-net";
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
//
// Override at runtime via `localStorage`:
//   localStorage.setItem("dofusAuthHost", "127.0.0.1");
//   localStorage.setItem("dofusAuthPort", "14444"); // docker-override port
// Or via URL query: `?authHost=...&authPort=...`.
function readEndpointOverride(): { host: string; port: number } {
  let host = "127.0.0.1";
  let port = 4444;
  try {
    if (typeof localStorage !== "undefined") {
      const h = localStorage.getItem("dofusAuthHost");
      const p = localStorage.getItem("dofusAuthPort");
      if (h) host = h;
      if (p) {
        const n = Number(p);
        if (Number.isFinite(n) && n > 0 && n < 65536) port = n;
      }
    }
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search ?? "");
      const h = params.get("authHost");
      const p = params.get("authPort");
      if (h) host = h;
      if (p) {
        const n = Number(p);
        if (Number.isFinite(n) && n > 0 && n < 65536) port = n;
      }
    }
  } catch {
    // ignore — defaults above win
  }
  return { host, port };
}
const { host: AUTH_HOST, port: AUTH_PORT } = readEndpointOverride();
// AraknemuHorizon's `config.conf` ships `client.version = "1.43.7"`
// by default. Match it here or edit `config.conf` so the two agree —
// otherwise the server replies `AlEv<expected>` and closes the
// socket before the credentials packet is even processed.
const CLIENT_VERSION = "1.43.7";
const LANGUAGE = "en";

// Transport selection.
//
// Two environments:
//   1. Electrobun (production) — CEF webview wrapped by a Bun host.
//      `window.electrobun` exists; raw TCP is reachable via the
//      `tcpConnect` RPC bridge to `Bun.connect`. AraknemuHorizon is
//      configured with `transport.mode = "tcp"`.
//   2. Vanilla browser tab (headless dev iteration, CI sweeps,
//      browser-only demos) — no native bridge, no raw TCP. Use the
//      browser `WebSocket` API. AraknemuHorizon must be configured
//      with `transport.mode = "websocket"` (set via
//      `TRANSPORT_MODE=websocket` env var, see docker-compose).
//
// The selection is environment-driven, not a build flag, so the same
// bundle works in both contexts. `URLSearchParams("transport=ws|tcp")`
// can force a specific mode for debugging.
//
// `localStorage.dofusNetUrl = "ws://127.0.0.1:14444/"` overrides the
// WS endpoint host/port — useful when the emulator's docker-compose
// remaps ports (the local override file remaps to 14444/15555).
function selectTransport(): "rpc" | "ws" {
  try {
    if (typeof window !== "undefined") {
      const forced = new URLSearchParams(window.location.search ?? "").get(
        "transport",
      );
      if (forced === "ws") return "ws";
      if (forced === "tcp" || forced === "rpc") return "rpc";
    }
  } catch {
    // ignore — defaults below win
  }
  // Heuristic: Electrobun injects `window.electrobun` (or the
  // `electroview` global). Absence ⇒ vanilla browser ⇒ WebSocket.
  if (
    typeof window !== "undefined" &&
    !(window as unknown as { electrobun?: unknown }).electrobun &&
    typeof WebSocket !== "undefined"
  ) {
    return "ws";
  }
  return "rpc";
}

const transportMode = selectTransport();
if (transportMode === "ws") {
  setTransportFactory(makeWebSocketFactory({ path: "/" }));
  if (typeof console !== "undefined") {
    console.log("[App] transport: WebSocket (browser)");
  }
} else {
  // CEF / Chromium can't open raw TCP. Route every dofus1-net socket
  // through electrobun's RPC bridge to the Bun main process — where
  // `Bun.connect` lives. Runs once at module load (idempotent).
  initRpcTransport();
  setTransportFactory(openRpcSocket);
  if (typeof console !== "undefined") {
    console.log("[App] transport: RPC→Bun.connect (Electrobun)");
  }
}

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
