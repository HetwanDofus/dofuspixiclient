<script lang="ts">
  import { onDestroy, onMount } from "svelte";

  import { Battlefield } from "@/ank/battlefield";
  import { GameClient } from "@/game/game-client";
  import { Keybindings } from "@/hud/core/keybindings";
  import { getLoadProgress } from "@/render/load-progress";

  interface Props {
    onReady?: () => void;
    onProgress?: (percent: number, label: string) => void;
  }

  let { onReady, onProgress }: Props = $props();

  let canvasContainer: HTMLDivElement;
  let battlefield: Battlefield | null = null;
  let gameClient: GameClient | null = null;
  let isLoading = true;
  let isResizing = false;
  let error: string | null = null;
  let debugEnabled = false;
  let stressTestActive = false;

  // Connection state
  let connected = false;
  let loggedIn = false;
  let characters: Array<{
    id: number;
    name: string;
    class: number;
    level: number;
  }> = [];

  function handleResizeStart() {
    isResizing = true;
  }

  function handleResizeEnd() {
    isResizing = false;
  }

  let unsubProgress: (() => void) | null = null;

  onMount(async () => {
    try {
      // Subscribe to asset load progress
      unsubProgress = getLoadProgress().onProgress((loaded, total, label) => {
        if (total > 0) {
          const pct = Math.round((loaded / total) * 100);
          onProgress?.(pct, label);
        }
      });

      onProgress?.(5, "Initializing engine...");

      battlefield = new Battlefield({
        container: canvasContainer,
        onResizeStart: handleResizeStart,
        onResizeEnd: handleResizeEnd,
        resizeDebounceMs: 300,
        preferWebGPU: true,
      });
      await battlefield.init();
      onProgress?.(30, "Loading assets...");

      try {
        await battlefield.loadManifest();
      } catch (manifestErr) {
        console.warn("Failed to load manifest:", manifestErr);
      }
      onProgress?.(50, "Loading UI...");

      // Initialize game client
      gameClient = new GameClient();
      gameClient.setBattlefield(battlefield);

      gameClient.setOnConnected(() => {
        connected = true;
        console.log("[MapRenderer] Connected — logging in...");
        // Auto-login for development
        gameClient?.login("admin", "admin");
      });

      gameClient.setOnDisconnected(() => {
        connected = false;
        loggedIn = false;
      });

      gameClient.setOnCharacterList((chars) => {
        characters = chars;
        loggedIn = true;
        // Auto-select first character for development
        if (chars.length > 0) {
          console.log("[MapRenderer] Auto-selecting character:", chars[0].name);
          gameClient?.selectCharacter(chars[0].id, chars[0].class);
        }
      });

      gameClient.setOnLoginFailed((reason) => {
        console.error("[MapRenderer] Login failed:", reason);
        // Fall back to local map loading
        loadLocalMap();
      });

      // Try connecting to server
      onProgress?.(65, "Connecting to server...");
      gameClient.connect();

      // Fallback: if not connected after 3s, load local map
      setTimeout(() => {
        if (!connected) {
          console.log("[MapRenderer] Server unavailable, loading local map");
          loadLocalMap();
        }
      }, 3000);

      onProgress?.(80, "Loading banner...");
      await battlefield.waitForBannerLoaded();
      onProgress?.(100, "Ready!");
      isLoading = false;
      onReady?.();
      setupKeybindings();
    } catch (err) {
      error =
        err instanceof Error ? err.message : "Failed to initialize renderer";
      console.error("Initialization error:", err);
      isLoading = false;
      onReady?.();
    }
  });

  async function loadLocalMap() {
    try {
      await battlefield?.loadMap(7411);
    } catch (mapErr) {
      console.warn("Failed to load local map:", mapErr);
    }
  }

  let keybindings: Keybindings | null = null;

  function setupKeybindings() {
    keybindings = new Keybindings();
    keybindings.on("toggleStats", () => {
      if (battlefield) {
        battlefield.getStatsPanel()?.toggle();
      }
    });
    keybindings.on("toggleDebug", () => {
      if (battlefield) {
        debugEnabled = battlefield.toggleDebug();
      }
    });
    keybindings.on("toggleGrid", () => {
      if (battlefield) {
        battlefield.toggleGridOverlay();
      }
    });
    keybindings.on("toggleStressTest", () => {
      if (battlefield) {
        stressTestActive = battlefield.toggleStressTest();
      }
    });
    keybindings.on("toggleWorldMap", () => {
      battlefield?.toggleWorldMap();
    });
    keybindings.on("escape", () => {
      if (!battlefield) return;
      // Close the topmost open panel
      if (battlefield.getWorldMapPanel()?.isVisible()) {
        battlefield.getWorldMapPanel()?.hide();
      } else if (battlefield.getStatsPanel()?.isVisible()) {
        battlefield.getStatsPanel()?.hide();
      }
    });
    keybindings.attach();
  }

  onDestroy(() => {
    unsubProgress?.();
    keybindings?.destroy();
    gameClient?.destroy();
    battlefield?.destroy();
  });

  function handleWheel(e: WheelEvent) {
    if (battlefield) {
      battlefield.handleWheel(e);
    }
  }

  function handleContextMenu(e: MouseEvent) {
    e.preventDefault();
    if (battlefield) {
      battlefield.handleContextMenu(e);
    }
  }
</script>

<div
  class="map-renderer"
  class:resizing={isResizing}
  bind:this={canvasContainer}
  on:wheel={handleWheel}
  on:contextmenu={handleContextMenu}
  role="application"
>
  {#if isResizing}
    <div class="resize-overlay">
      <div class="spinner"></div>
      <p>Adjusting resolution...</p>
    </div>
  {/if}

  {#if error}
    <div class="error-overlay">
      <p class="error-message">{error}</p>
    </div>
  {/if}

  {#if debugEnabled}
    <div class="debug-indicator">
      DEBUG MODE (Press D to toggle) - Hover tiles for info
    </div>
  {/if}

  {#if stressTestActive}
    <div class="stress-indicator">
      STRESS TEST - 1000 actors (Press T to stop)
    </div>
  {/if}

  {#if connected}
    <div class="connection-indicator connected">Connected</div>
  {:else}
    <div class="connection-indicator offline">Offline</div>
  {/if}
</div>

<style>
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

  .map-renderer :global(canvas) {
    display: block;
    transition: filter 0.15s ease-out;
    image-rendering: pixelated;
    image-rendering: crisp-edges;
  }

  .map-renderer.resizing :global(canvas) {
    filter: blur(2px);
    image-rendering: pixelated;
  }

  .loading-overlay,
  .error-overlay,
  .resize-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
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
    width: 40px;
    height: 40px;
    animation: spin 1s linear infinite;
    margin-bottom: 1rem;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .error-message {
    color: #ff6b6b;
    font-weight: bold;
  }

  .debug-indicator {
    position: absolute;
    top: 10px;
    left: 10px;
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
    top: 10px;
    right: 10px;
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
    top: 10px;
    left: 50%;
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
</style>
