import { useCallback, useEffect, useRef, useState } from "react";
import { Application } from "pixi.js";

import { Battlefield } from "@/ank/battlefield";
import { GameClient } from "@/game/game-client";
import { Keybindings } from "@/hud/core/keybindings";
import { getLoadProgress } from "@/render/load-progress";
import { hudStore, togglePanel, toggleWorldMap, closeAllPanels } from "@/stores";
import { HudOverlay } from "@/hud/HudOverlay";
import { PixiAppContext } from "@/hud/contexts/PixiAppContext";
import { GameClientContext } from "@/hud/contexts/GameClientContext";

interface MapRendererProps {
  onReady?: () => void;
  onProgress?: (percent: number, label: string) => void;
}

export default function MapRenderer({ onReady, onProgress }: MapRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const battlefieldRef = useRef<Battlefield | null>(null);
  const gameClientRef = useRef<GameClient | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [debugEnabled, setDebugEnabled] = useState(false);
  const [stressTestActive, setStressTestActive] = useState(false);
  const [pixiApp, setPixiApp] = useState<Application | null>(null);
  const [baseZoom, setBaseZoom] = useState(2);
  const [canvasRect, setCanvasRect] = useState({ left: 0, top: 0, w: 0, h: 0 });

  const handleWheel = useCallback((e: React.WheelEvent) => {
    battlefieldRef.current?.handleWheel(e.nativeEvent);
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    battlefieldRef.current?.handleContextMenu(e.nativeEvent);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let keybindings: Keybindings | null = null;
    let battlefield: Battlefield | null = null;
    let gameClient: GameClient | null = null;
    let unsubProgress: (() => void) | null = null;
    let destroyed = false;

    async function init() {
      try {
        unsubProgress = getLoadProgress().onProgress((loaded, total, label) => {
          if (total > 0) {
            const pct = Math.round((loaded / total) * 100);
            onProgress?.(pct, label);
          }
        });

        onProgress?.(5, "Initializing engine...");

        battlefield = new Battlefield({
          container: container!,
          onResizeStart: () => setIsResizing(true),
          onResizeEnd: () => setIsResizing(false),
          resizeDebounceMs: 300,
          preferWebGPU: true,
        });
        battlefieldRef.current = battlefield;
        await battlefield.init();
        const pixiAppInstance = battlefield.getApp();
        setPixiApp(pixiAppInstance);
        setBaseZoom(battlefield.getBaseZoom());
        if (destroyed) return;

        onProgress?.(30, "Loading assets...");

        try {
          await battlefield.loadManifest();
        } catch (manifestErr) {
          console.warn("Failed to load manifest:", manifestErr);
        }
        if (destroyed) return;

        onProgress?.(50, "Loading UI...");

        gameClient = new GameClient();
        gameClientRef.current = gameClient;
        (window as any).gameClient = gameClient;
        gameClient.setBattlefield(battlefield);

        gameClient.setOnConnected(() => {
          setConnected(true);
          hudStore.setState({ connected: true });
          console.log("[MapRenderer] Connected — logging in...");
          gameClient?.login("admin", "admin");
        });

        gameClient.setOnDisconnected(() => {
          setConnected(false);
          hudStore.setState({ connected: false, loggedIn: false });
        });

        gameClient.setOnCharacterList((chars) => {
          hudStore.setState({ loggedIn: true });
          if (chars.length > 0) {
            console.log("[MapRenderer] Auto-selecting character:", chars[0].name);
            gameClient?.selectCharacter(chars[0].id, chars[0].class);
          }
        });

        gameClient.setOnLoginFailed((reason) => {
          console.error("[MapRenderer] Login failed:", reason);
          loadLocalMap();
        });

        onProgress?.(65, "Connecting to server...");
        gameClient.connect();

        setTimeout(() => {
          if (!destroyed && !hudStore.getSnapshot().connected) {
            console.log("[MapRenderer] Server unavailable, loading local map");
            loadLocalMap();
          }
        }, 3000);

        onProgress?.(100, "Ready!");
        onReady?.();

        // Setup keybindings
        keybindings = new Keybindings();
        keybindings.on("toggleStats", () => {
          togglePanel("stats");
        });
        keybindings.on("toggleDebug", () => {
          if (battlefield) {
            const enabled = battlefield.toggleDebug();
            setDebugEnabled(enabled);
            hudStore.setState({ debugEnabled: enabled });
          }
        });
        keybindings.on("toggleGrid", () => {
          battlefield?.toggleGridOverlay();
        });
        keybindings.on("toggleTransparency", () => {
          battlefield?.toggleTransparency();
        });
        keybindings.on("toggleStressTest", () => {
          if (battlefield) {
            const active = battlefield.toggleStressTest();
            setStressTestActive(active);
            hudStore.setState({ stressTestActive: active });
          }
        });
        keybindings.on("toggleWorldMap", () => {
          toggleWorldMap();
        });
        keybindings.on("escape", () => {
          const { activePanel, isWorldMapOpen } = hudStore.getSnapshot();
          if (isWorldMapOpen) {
            toggleWorldMap();
          } else if (activePanel) {
            closeAllPanels();
          }
        });
        keybindings.attach();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to initialize renderer"
        );
        console.error("Initialization error:", err);
        onReady?.();
      }
    }

    async function loadLocalMap() {
      try {
        await battlefield?.loadMap(7411);
      } catch (mapErr) {
        console.warn("Failed to load local map:", mapErr);
      }
    }

    init();

    return () => {
      destroyed = true;
      unsubProgress?.();
      keybindings?.destroy();
      gameClient?.destroy();
      battlefield?.destroy();
      battlefieldRef.current = null;
      gameClientRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Track the actual canvas element position within the container
  useEffect(() => {
    const parent = containerRef.current;
    if (!parent || !pixiApp) return;
    const canvas = parent.querySelector("canvas");
    if (!canvas) return;

    function sync() {
      const pr = parent!.getBoundingClientRect();
      const cr = canvas!.getBoundingClientRect();
      setCanvasRect({
        left: cr.left - pr.left,
        top: cr.top - pr.top,
        w: cr.width,
        h: cr.height,
      });
    }
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(canvas);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [pixiApp]);

  return (
    <PixiAppContext.Provider value={pixiApp}>
      <GameClientContext.Provider value={gameClientRef.current}>
        <div
          ref={containerRef}
          className={`map-renderer${isResizing ? " resizing" : ""}`}
          onWheel={handleWheel}
          onContextMenu={handleContextMenu}
          role="application"
        >
      {isResizing && (
        <div className="resize-overlay">
          <div className="spinner" />
          <p>Adjusting resolution...</p>
        </div>
      )}

      {error && (
        <div className="error-overlay">
          <p className="error-message">{error}</p>
        </div>
      )}

      {debugEnabled && (
        <div className="debug-indicator">
          DEBUG MODE (Press D to toggle) - Hover tiles for info
        </div>
      )}

      {stressTestActive && (
        <div className="stress-indicator">
          STRESS TEST - 1000 actors (Press T to stop)
        </div>
      )}

      <div className={`connection-indicator ${connected ? "connected" : "offline"}`}>
        {connected ? "Connected" : "Offline"}
      </div>

      <HudOverlay baseZoom={baseZoom} canvasRect={canvasRect} />

      <style>{`
        .map-renderer {
          flex: 1;
          position: relative;
          background: #1a1a1a;
          overflow: hidden;
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .map-renderer canvas {
          display: block;
          transition: filter 0.15s ease-out;
          image-rendering: pixelated;
          image-rendering: crisp-edges;
        }
        .map-renderer.resizing canvas {
          filter: blur(2px);
          image-rendering: pixelated;
        }
        .loading-overlay, .error-overlay, .resize-overlay {
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          background: rgba(0, 0, 0, 0.8);
          color: white;
          z-index: 1000;
        }
        .resize-overlay {
          background: rgba(0, 0, 0, 0.5);
          backdrop-filter: blur(4px);
          z-index: 999;
        }
        .spinner {
          border: 4px solid rgba(255, 255, 255, 0.1);
          border-left-color: #fff;
          border-radius: 50%;
          width: 40px; height: 40px;
          animation: spin 1s linear infinite;
          margin-bottom: 1rem;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .error-message { color: #ff6b6b; font-weight: bold; }
        .debug-indicator {
          position: absolute;
          top: 10px; left: 10px;
          background: rgba(0, 100, 0, 0.9);
          color: #0f0;
          padding: 8px 12px;
          border-radius: 4px;
          font-family: monospace;
          font-size: 12px;
          z-index: 1001;
          border: 1px solid #0f0;
        }
        .connection-indicator {
          position: absolute;
          top: 10px; right: 10px;
          padding: 4px 10px;
          border-radius: 4px;
          font-family: monospace;
          font-size: 11px;
          z-index: 1001;
        }
        .connection-indicator.connected {
          background: rgba(0, 100, 0, 0.8);
          color: #0f0;
          border: 1px solid #0f0;
        }
        .connection-indicator.offline {
          background: rgba(100, 0, 0, 0.8);
          color: #f66;
          border: 1px solid #f66;
        }
        .stress-indicator {
          position: absolute;
          top: 10px; left: 50%;
          transform: translateX(-50%);
          background: rgba(100, 50, 0, 0.9);
          color: #ffa500;
          padding: 8px 16px;
          border-radius: 4px;
          font-family: monospace;
          font-size: 12px;
          z-index: 1001;
          border: 1px solid #ffa500;
        }
      `}</style>
        </div>
      </GameClientContext.Provider>
    </PixiAppContext.Provider>
  );
}
