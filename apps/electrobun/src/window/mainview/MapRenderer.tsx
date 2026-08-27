import type { Application } from "pixi.js";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type { GameClient } from "@/game/game-client";
import { getLoadProgress } from "@/game/render/load-progress";
import { Battlefield } from "@/game/scene";
import {
  closeAllPanels,
  hudStore,
  toggleHotbarTab,
  togglePanel,
  toggleWorldMap,
} from "@/game/stores";
import {
  type ConnectionStatus,
  connectionStore,
} from "@/game/stores/connection-store";
import { activateSlot } from "@/hud/banner/hotbar-actions";
import { GameClientContext } from "@/hud/contexts/GameClientContext";
import { PixiAppContext } from "@/hud/contexts/PixiAppContext";
import { HOTBAR_SHORTCUTS, Keybindings } from "@/hud/core/keybindings";
import { HudOverlay } from "@/hud/HudOverlay";

const CONNECTION_LABEL: Record<ConnectionStatus, string> = {
  connecting: "Connexion…",
  connected: "Connecté",
  reconnecting: "Reconnexion…",
  lost: "Déconnecté",
};

interface MapRendererProps {
  client: GameClient;
  onReady?: () => void;
  onProgress?: (percent: number, label: string) => void;
}

export function MapRenderer({ client, onReady, onProgress }: MapRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const battlefieldRef = useRef<Battlefield | null>(null);
  const gameClientRef = useRef<GameClient | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debugEnabled, setDebugEnabled] = useState(false);
  const [pixiApp, setPixiApp] = useState<Application | null>(null);
  const [baseZoom, setBaseZoom] = useState(2);
  const [canvasRect, setCanvasRect] = useState({ left: 0, top: 0, w: 0, h: 0 });
  // Live, not a snapshot: this used to be a useState set once during setup, so
  // the badge kept claiming "Connected" through core restarts and outright
  // socket deaths alike (QA-046).
  const { status: connectionStatus } = useSyncExternalStore(
    connectionStore.subscribe,
    connectionStore.getSnapshot
  );
  const connected = connectionStatus === "connected";

  // hudStore.connected mirrors the same source of truth, for HUD widgets that
  // read the store rather than subscribing here.
  useEffect(() => {
    hudStore.setState({ connected });
  }, [connected]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    battlefieldRef.current?.handleContextMenu(e.nativeEvent);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: one-shot init — onReady/onProgress closure captures are intentional
  useEffect(() => {
    const rootEl = containerRef.current;

    if (!rootEl) {
      return;
    }

    const container: HTMLElement = rootEl;

    let keybindings: Keybindings | null = null;
    let battlefield: Battlefield | null = null;
    const gameClient: GameClient = client;
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
          container,
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

        if (destroyed) {
          return;
        }

        onProgress?.(30, "Loading assets...");

        try {
          await battlefield.loadManifest();
        } catch (manifestErr) {
          console.warn("Failed to load manifest:", manifestErr);
        }

        if (destroyed) {
          return;
        }

        onProgress?.(50, "Loading UI...");

        // GameClient is owned by App (shared with AuthFlow) — we just wire
        // the battlefield to it and trust the session is already authenticated
        // on gamed. setBattlefield also forwards cell-click events to the
        // client's movement command.
        gameClientRef.current = gameClient;
        (window as unknown as { gameClient: GameClient }).gameClient =
          gameClient;
        gameClient.setBattlefield(battlefield);
        hudStore.setState({ loggedIn: true });

        onProgress?.(100, "Ready!");
        onReady?.();

        keybindings = new Keybindings();

        keybindings.on("CHARAC", () => {
          togglePanel("stats");
        });

        keybindings.on("SPELLS", () => {
          togglePanel("spells");
        });

        keybindings.on("INVENTORY", () => {
          togglePanel("inventory");
        });

        keybindings.on("QUESTS", () => {
          togglePanel("quests");
        });

        keybindings.on("FRIENDS", () => {
          togglePanel("friends");
        });

        keybindings.on("GUILD", () => {
          togglePanel("guild");
        });

        keybindings.on("MOUNT", () => {
          togglePanel("mount");
        });

        keybindings.on("MAP", () => {
          toggleWorldMap();
        });

        // The hotbar: SWAP flips the Spells/Items tabs, SH1..SH14
        // activate the cell at that index of the *visible* page. Both go
        // through `hotbar-actions` so the keyboard and the mouse can
        // never drift apart. Casting from a spell cell stays inert
        // outside a fight, which is the 1.29 rule.
        keybindings.on("SWAP", () => {
          toggleHotbarTab();
        });

        HOTBAR_SHORTCUTS.forEach((shortcut, index) => {
          keybindings?.on(shortcut, () => {
            activateSlot(gameClientRef.current, index);
          });
        });

        keybindings.on("DEBUG_TOGGLE", () => {
          if (!battlefield) {
            return;
          }

          const enabled = battlefield.toggleDebug();
          setDebugEnabled(enabled);
          hudStore.setState({ debugEnabled: enabled });
        });

        keybindings.on("DEBUG_GRID", () => {
          battlefield?.toggleGridOverlay();
        });

        keybindings.on("DEBUG_TRANSPARENCY", () => {
          battlefield?.toggleTransparency();
        });

        keybindings.on("ESCAPE", () => {
          const { activePanel, isWorldMapOpen } = hudStore.getSnapshot();

          if (isWorldMapOpen) {
            toggleWorldMap();
            return;
          }

          if (activePanel) {
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

    init();

    return () => {
      destroyed = true;
      unsubProgress?.();
      keybindings?.destroy();
      // gameClient is owned by App — do NOT destroy it here.
      battlefield?.destroy();
      battlefieldRef.current = null;
      gameClientRef.current = null;
    };
  }, []);

  useEffect(() => {
    const parent = containerRef.current;

    if (!parent || !pixiApp) {
      return;
    }

    // Use the main Pixi app's canvas directly — a querySelector() on the
    // container would also match nested canvases from HUD components
    // (e.g. the Minimap's standalone PIXI slot), which produces a bogus
    // 176×176 canvasRect and breaks HUD positioning.
    const canvas = pixiApp.canvas;

    if (!canvas) {
      return;
    }

    function sync() {
      if (!parent || !canvas) {
        return;
      }

      const pr = parent.getBoundingClientRect();
      const cr = canvas.getBoundingClientRect();
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

          <div
            className={`connection-indicator ${connected ? "connected" : "offline"}`}
          >
            {CONNECTION_LABEL[connectionStatus]}
          </div>

          <HudOverlay
            baseZoom={baseZoom}
            canvasRect={canvasRect}
            gameClient={gameClientRef.current}
          />

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
          image-rendering: optimizeQuality;
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
      `}</style>
        </div>
      </GameClientContext.Provider>
    </PixiAppContext.Provider>
  );
}
