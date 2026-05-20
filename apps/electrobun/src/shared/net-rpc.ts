// Shared RPC schema for the TCP bridge between the webview (browser
// context) and the Bun main process. The webview runs in Chromium /
// CEF which has no raw-socket API — `Bun.connect` lives in the main
// process. We give the webview an `openTcpSocket`-compatible handle
// by proxying every operation through electrobun's RPC bridge.
//
// Lifecycle:
//   webview                                 bun
//   ─────────────                           ─────────────
//   tcpConnect({host, port})  ────────────► Bun.connect → socketId
//             ◄──────────────  {socketId}
//
//   tcpSend({socketId, frame}) (message)──► socket.write(frame)
//
//             ◄──────────  tcpFrame({socketId, frame})  (message)
//             ◄──────────  tcpClose({socketId, byPeer, error}) (message)
//
//   tcpDisconnect({socketId}) ─────────────► socket.end()
//
// Frames are 8-bit-clean ASCII (canonical Dofus 1.29 wire); JSON.stringify
// over the RPC transport preserves them. Crypto stays on the webview
// side so the bridge sees plaintext frames in both directions.

export interface NetRPCSchema {
  bun: {
    requests: {
      tcpConnect: {
        params: { host: string; port: number };
        response: { socketId: number };
      };
      tcpDisconnect: {
        params: { socketId: number };
        response: void;
      };
    };
    messages: {
      /** Webview → Bun: write this frame to the named socket. */
      tcpSend: { socketId: number; frame: string };
    };
  };
  webview: {
    requests: Record<string, never>;
    messages: {
      /** Bun → webview: an inbound frame arrived. */
      tcpFrame: { socketId: number; frame: string };
      /** Bun → webview: the socket closed. */
      tcpClose: {
        socketId: number;
        byPeer: boolean;
        error?: string;
      };
    };
  };
}
