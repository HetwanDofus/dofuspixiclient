import { useEffect, useRef } from "react";

import { hudStore, toggleWorldMap } from "@/game/stores";
import { WorldMapRenderer } from "@/game/worldmap";

import { usePixiApp } from "../contexts/PixiAppContext";

interface WorldMapPanelProps {
  visible: boolean;
  zoom: number;
  canvasWidth: number;
  canvasHeight: number;
}

/**
 * World map panel.
 * The map itself renders via PIXI (WorldMapRenderer) on the main stage.
 * React controls visibility and provides the close overlay.
 */
export function WorldMapPanel({
  visible,
  zoom: _zoom,
  canvasWidth,
  canvasHeight,
}: WorldMapPanelProps) {
  const app = usePixiApp();
  const rendererRef = useRef<WorldMapRenderer | null>(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!app || !visible) {
      return;
    }

    async function init() {
      if (!app) {
        return;
      }

      if (!rendererRef.current) {
        const { Container } = await import("pixi.js");
        const mapContainer = new Container();
        mapContainer.label = "world-map-react";
        app.stage.addChild(mapContainer);

        rendererRef.current = new WorldMapRenderer({
          app,
          parentContainer: mapContainer,
          onTeleport: (mapId) => {
            console.log("World map teleport:", mapId);
          },
        });
      }

      const renderer = rendererRef.current;
      renderer.setViewSize(canvasWidth, canvasHeight);

      if (!loadedRef.current) {
        await renderer.loadWorldMap(0);
        loadedRef.current = true;
      }

      const currentMapId = hudStore.getSnapshot().minimapMapId;
      renderer.show();

      if (currentMapId != null) {
        renderer.centerOnMapId(currentMapId);
      }
    }

    init();

    return () => {
      rendererRef.current?.hide();
    };
  }, [app, visible, canvasWidth, canvasHeight]);

  useEffect(() => {
    return () => {
      rendererRef.current?.destroy();
      rendererRef.current = null;
      loadedRef.current = false;
    };
  }, []);

  if (!visible) {
    return null;
  }

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 15,
        pointerEvents: "auto",
      }}
    >
      {/* Header bar */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 24,
          background: "var(--dofus-header-bg, #514a3c)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 8px",
          zIndex: 16,
        }}
      >
        <span
          style={{
            color: "white",
            fontWeight: "bold",
            fontSize: 13,
            fontFamily: "Verdana, sans-serif",
          }}
        >
          Carte du monde
        </span>
        <button
          type="button"
          onClick={() => toggleWorldMap()}
          aria-label="Close"
          style={{
            background: "transparent",
            border: 0,
            padding: 0,
            cursor: "pointer",
          }}
        >
          <img
            src="/themes/classic/assets/common/close-up.svg"
            alt=""
            width={12}
            height={12}
            draggable={false}
          />
        </button>
      </div>

      {/* Help text */}
      <div
        style={{
          position: "absolute",
          bottom: 20,
          left: "50%",
          transform: "translateX(-50%)",
          color: "white",
          fontSize: 14,
          fontFamily: "Verdana, sans-serif",
          background: "rgba(0, 0, 0, 0.7)",
          padding: "10px 20px",
          borderRadius: 5,
          border: "1px solid rgba(255, 255, 255, 0.3)",
          zIndex: 16,
          pointerEvents: "none",
        }}
      >
        <kbd
          style={{
            background: "#333",
            padding: "2px 8px",
            borderRadius: 3,
            border: "1px solid #555",
            fontWeight: "bold",
            fontFamily: "monospace",
          }}
        >
          M
        </kbd>{" "}
        Fermer
        {" | "}
        <kbd
          style={{
            background: "#333",
            padding: "2px 8px",
            borderRadius: 3,
            border: "1px solid #555",
            fontWeight: "bold",
            fontFamily: "monospace",
          }}
        >
          Glisser
        </kbd>{" "}
        Déplacer
        {" | "}
        <kbd
          style={{
            background: "#333",
            padding: "2px 8px",
            borderRadius: 3,
            border: "1px solid #555",
            fontWeight: "bold",
            fontFamily: "monospace",
          }}
        >
          Molette
        </kbd>{" "}
        Zoom
      </div>
    </div>
  );
}
