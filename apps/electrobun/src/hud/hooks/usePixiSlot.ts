import { Application, Container } from "pixi.js";
import { type DependencyList, type RefObject, useEffect, useRef } from "react";

/**
 * Hook that creates a standalone PIXI Application inside a DOM element.
 *
 * Use this when the embedded PIXI content does NOT need access to the
 * main game renderer's texture cache (e.g., a self-contained mini-app).
 *
 * @param factory - Called once after the PIXI app initializes.
 *   Receives the Application and root Container. May return a cleanup function.
 * @param deps - React dependency list to re-initialize the slot.
 * @returns A ref to attach to the container div.
 */
export function usePixiSlot(
  factory: (app: Application, container: Container) => (() => void) | undefined,
  deps: DependencyList = []
): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;

    if (!el) {
      return;
    }

    const app = new Application();
    let cleanup: (() => void) | undefined;
    let destroyed = false;

    app
      .init({
        resizeTo: el,
        backgroundAlpha: 0,
        antialias: true,
      })
      .then(() => {
        if (destroyed) {
          app.destroy(true);
          return;
        }

        el.appendChild(app.canvas);
        const container = new Container();
        app.stage.addChild(container);
        cleanup = factory(app, container);
      });

    return () => {
      destroyed = true;
      cleanup?.();

      try {
        app.destroy(true);
      } catch {
        // May already be destroyed
      }
    };
    // biome-ignore lint/correctness/useExhaustiveDependencies: caller-managed deps array
  }, deps);

  return ref;
}

/**
 * Hook that creates a PIXI Container rendered via the main game Application.
 *
 * Use this when the embedded content needs access to the main renderer's
 * texture cache (e.g., minimap rendering shared assets).
 *
 * The factory receives the main Application and a Container that's added
 * to the stage. The container is removed on cleanup.
 *
 * @param mainApp - The main PIXI Application instance (from PixiAppContext).
 * @param factory - Populates the container. May return a cleanup function.
 * @param deps - React dependency list.
 * @returns A ref to attach to a canvas element for rendering.
 */
export function usePixiSlotShared(
  mainApp: Application | null,
  factory: (container: Container) => (() => void) | undefined,
  deps: DependencyList = []
): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!mainApp || !ref.current) {
      return;
    }

    const container = new Container();
    mainApp.stage.addChild(container);
    const cleanup = factory(container);

    return () => {
      cleanup?.();
      mainApp.stage.removeChild(container);
      container.destroy({ children: true });
    };
  }, [mainApp, ...deps, factory]); // eslint-disable-line react-hooks/exhaustive-deps

  return ref;
}
