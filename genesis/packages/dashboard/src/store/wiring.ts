import type { ServerMessage } from "@genesis/protocol";
import { socket } from "../lib/ws.ts";
import { applyTheme, useUiStore } from "./uiStore.ts";
import { useWorldStore } from "./worldStore.ts";

/** Conecta el socket con los stores. Se llama una vez desde main.tsx. */
export function wireSocket(): void {
  socket.onStatus((status, attempt) => useWorldStore.getState().setConnection(status, attempt));
  socket.onMessage((msg: ServerMessage) => {
    switch (msg.t) {
      case "snapshot":
        useWorldStore.getState().applySnapshot(msg);
        break;
      case "delta":
        useWorldStore.getState().applyDelta(msg, useUiStore.getState().selectedId);
        break;
      case "notice":
        useUiStore.getState().pushToast(msg.level, msg.text);
        break;
      case "error":
        useUiStore.getState().pushToast("error", msg.message);
        break;
      case "pong":
        break;
    }
  });
  applyTheme(useUiStore.getState().theme);
  socket.connect();
}
