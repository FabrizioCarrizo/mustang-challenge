import type { ServerMessage } from "@genesis/protocol";
import { socket } from "../lib/ws.ts";
import { applyTheme, useUiStore } from "./uiStore.ts";
import { useWorldStore } from "./worldStore.ts";

/**
 * Un acto divino produce dos avisos para quien lo pidió: el que el runner
 * difunde a todos ("Dios: X oyó la voz") y la respuesta directa del socket
 * ("X oyó la voz"). Se normalizan para mostrar uno solo.
 */
function normalizeNotice(text: string): string {
  const m = /^Dios: no se pudo \((.*)\)$/.exec(text);
  if (m) return m[1]!;
  return text.replace(/^Dios: /, "");
}

const recent: Array<{ key: string; at: number }> = [];
const DEDUPE_MS = 2500;

function isDuplicate(text: string): boolean {
  const now = Date.now();
  const key = normalizeNotice(text);
  while (recent.length && now - recent[0]!.at > DEDUPE_MS) recent.shift();
  if (recent.some((r) => r.key === key)) return true;
  recent.push({ key, at: now });
  return false;
}

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
      case "notice": {
        if (isDuplicate(msg.text)) break;
        const ui = useUiStore.getState();
        ui.pushToast(msg.level, msg.text);
        ui.logNotice(msg.level, msg.text, useWorldStore.getState().liveTick);
        if (/^Dios: /.test(msg.text)) ui.resolveGodAct(normalizeNotice(msg.text), msg.level === "info");
        break;
      }
      case "error": {
        const ui = useUiStore.getState();
        ui.pushToast("error", msg.message);
        ui.logNotice("error", msg.message, useWorldStore.getState().liveTick);
        // un replay que no se pudo reconstruir deja al cliente en el presente
        useWorldStore.getState().cancelReplayRequest();
        break;
      }
      case "pong":
        break;
    }
  });
  applyTheme(useUiStore.getState().theme);
  socket.connect();
}
