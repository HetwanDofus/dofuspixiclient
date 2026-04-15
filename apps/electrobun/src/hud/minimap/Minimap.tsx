import { Container } from "pixi.js";
import { useEffect, useRef, useSyncExternalStore } from "react";

import { hudStore } from "@/game/stores";
import { MinimapRenderer } from "@/game/worldmap";

import { usePixiSlot } from "../hooks/usePixiSlot";

/**
 * Minimap embedded inside the main banner circle.
 * Creates its own standalone PIXI application and hosts a MinimapRenderer
 * that re-centers whenever the current map changes.
 */
export function Minimap() {
  const rendererRef = useRef<MinimapRenderer | null>(null);
  const readyRef = useRef(false);

  const { minimapMapId } = useSyncExternalStore(
    hudStore.subscribe,
    hudStore.getSnapshot
  );

  const ref = usePixiSlot((app, container) => {
    // Force the canvas to block display so it doesn't leave an inline baseline
    // gap that shifts the layout of the surrounding MainBannerCircle.
    app.canvas.style.display = "block";

    const viewport = new Container();
    viewport.scale.set(0.5);
    container.addChild(viewport);

    const renderer = new MinimapRenderer({
      app,
      parentContainer: viewport,
    });
    rendererRef.current = renderer;

    const recenter = () => {
      viewport.x = app.screen.width / 2;
      viewport.y = app.screen.height / 2;
    };
    recenter();

    // PIXI's resizeTo polling may not have measured the wrapper yet at factory
    // time, so app.screen can still be 0. Observe the canvas to pick up the
    // real dimensions as soon as the browser lays it out.
    const wrapper = app.canvas.parentElement;
    const resizeObserver =
      wrapper && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            app.resize();
            recenter();
          })
        : null;
    if (resizeObserver && wrapper) {
      resizeObserver.observe(wrapper);
    }

    let cancelled = false;
    renderer.loadWorldMap(0).then(() => {
      if (cancelled) {
        return;
      }

      readyRef.current = true;
      recenter();
      const currentMapId = hudStore.getSnapshot().minimapMapId;

      if (currentMapId != null) {
        renderer.centerOnMap(currentMapId);
      }
    });

    const handleResize = recenter;
    app.renderer.on("resize", handleResize);

    return () => {
      cancelled = true;
      readyRef.current = false;
      resizeObserver?.disconnect();
      app.renderer.off("resize", handleResize);
      renderer.destroy();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!readyRef.current || minimapMapId == null) {
      return;
    }

    rendererRef.current?.centerOnMap(minimapMapId, true);
  }, [minimapMapId]);

  return <div ref={ref} className="absolute inset-0" />;
}
