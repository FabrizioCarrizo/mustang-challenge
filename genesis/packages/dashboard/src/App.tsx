import type { EventInfo } from "@genesis/protocol";
import { useEffect } from "react";
import { ReplayBanner, ReplayBar } from "./components/ReplayBar.tsx";
import { RightPanel } from "./components/RightPanel.tsx";
import { Ticker } from "./components/Ticker.tsx";
import { Toasts } from "./components/Toasts.tsx";
import { TopBar, sendControl } from "./components/TopBar.tsx";
import { apiGet } from "./lib/api.ts";
import { MapCanvas } from "./map/MapCanvas.tsx";
import { useUiStore } from "./store/uiStore.ts";
import { isReplaying, useWorldStore } from "./store/worldStore.ts";

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

export function App() {
  const panelOpen = useUiStore((s) => s.panelOpen);
  const ready = useWorldStore((s) => s.ready);
  const connection = useWorldStore((s) => s.connection);
  const replaying = useWorldStore((s) => isReplaying(s));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isEditable(e.target) && !e.repeat) {
        e.preventDefault();
        if (isReplaying(useWorldStore.getState())) return;
        const paused = useWorldStore.getState().pacing?.paused ?? true;
        sendControl(paused ? "play" : "pause");
      } else if (e.key === "Escape") {
        const ui = useUiStore.getState();
        if (ui.noticesOpen) ui.toggleNotices(false);
        else if (ui.cellPicker) ui.setCellPicker(false);
        else if (ui.selectedId !== null && !isEditable(e.target)) ui.select(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // el teletipo arranca con los últimos sucesos notables (los deltas traen solo los nuevos)
  useEffect(() => {
    if (!ready) return;
    const ctrl = new AbortController();
    void apiGet<EventInfo[]>("/events/recent", ctrl.signal).then((r) => {
      if (r.status === "ok" && r.data.length) useWorldStore.getState().mergeEvents(r.data.slice().reverse());
    });
    return () => ctrl.abort();
  }, [ready]);

  return (
    <div className={`app${panelOpen ? "" : " app--panel-closed"}`}>
      <TopBar />
      <main className="main">
        <div className={`map-area${replaying ? " map-area--past" : ""}`}>
          <MapCanvas />
          {!replaying && <Ticker />}
          <ReplayBanner />
          {!ready && (
            <div className="overlay">
              <div className="overlay__box">{connection === "reconnecting" ? "Sin conexión con el mundo. Reintentando…" : "Conectando con el mundo…"}</div>
            </div>
          )}
          <Toasts />
        </div>
        <ReplayBar />
      </main>
      <RightPanel />
    </div>
  );
}
