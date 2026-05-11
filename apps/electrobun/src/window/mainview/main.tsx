import { createRoot } from "react-dom/client";

import "./index.css";
import "./typography.css";

import { App } from "./App";
import { StressPage } from "./StressPage";

async function start() {
  // @TODO: fix later — force-load fonts before mount so PixiJS can use them
  await Promise.all([
    document.fonts.load('normal 12px "bit-mini-6"'),
    document.fonts.load('bold 12px "impact"'),
    document.fonts.load('bold 12px "eras"'),
  ]);

  const appEl = document.getElementById("app");

  if (!appEl) {
    throw new Error("Root element #app not found in index.html");
  }

  const root = createRoot(appEl);
  // `#stress` boots the isolated Pixi+Vello stress test (single canvas,
  // shared GPUDevice via the patched wgpu fork). Anything else boots
  // the normal app.
  if (window.location.hash === "#stress") {
    root.render(<StressPage />);
  } else {
    root.render(<App />);
  }
}

start();
