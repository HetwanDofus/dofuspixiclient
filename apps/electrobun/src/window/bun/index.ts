import { BrowserWindow, Updater, Utils } from "electrobun/bun";
import { defineElectrobunRPC } from "electrobun/bun";

import type { NetRPCSchema } from "@/shared/net-rpc";

import { createNetBridge } from "./net-bridge";
import { startProcessStatsLogger } from "./process-stats";

// Start before the window opens so the first samples capture the
// CEF host launch + GPU process boot.
startProcessStatsLogger();

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

// Check if Vite dev server is running for HMR
async function getMainViewUrl(): Promise<string> {
  const channel = await Updater.localInfo.channel();

  if (channel === "dev") {
    try {
      await fetch(DEV_SERVER_URL, { method: "HEAD" });
      console.log(`HMR enabled: Using Vite dev server at ${DEV_SERVER_URL}`);
      return DEV_SERVER_URL;
    } catch {
      console.log(
        "Vite dev server not running. Run 'bun run dev:hmr' for HMR support."
      );
    }
  }

  return "views://mainview/index.html";
}

// Create the main application window
const url = await getMainViewUrl();

// TCP bridge — the webview proxies every dofus1-net socket op
// through this RPC handler. See `apps/electrobun/src/shared/net-rpc.ts`
// for the schema.
const netBridge = createNetBridge();

const rpc = defineElectrobunRPC<NetRPCSchema, "bun">("bun", {
  handlers: {
    requests: netBridge.requests,
    messages: netBridge.messages,
  },
});

const mainWindow = new BrowserWindow({
  title: "Dofus Web Client",
  url,
  renderer: "cef",
  frame: {
    width: 900,
    height: 700,
    x: 200,
    y: 200,
  },
  rpc,
});

// `mainWindow.webview.rpc` is the bound RPC instance; the bridge
// needs it to emit messages back to the webview.
netBridge.attach(
  mainWindow.webview.rpc as unknown as {
    send: Record<string, (p: unknown) => void>;
  },
);

// Quit the app when the main window is closed
mainWindow.on("close", () => {
  Utils.quit();
});

console.log("Dofus Web Client started!");
