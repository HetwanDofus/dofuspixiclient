import { createRoot } from "react-dom/client";

import "./index.css";
import "./typography.css";
import App from "./App";

async function start() {
  // @TODO: fix later — force-load fonts before mount so PixiJS can use them
  await Promise.all([
    document.fonts.load('normal 12px "bit-mini-6"'),
    document.fonts.load('bold 12px "impact"'),
    document.fonts.load('bold 12px "eras"'),
  ]);

  const root = createRoot(document.getElementById("app")!);
  root.render(<App />);
}

start();
