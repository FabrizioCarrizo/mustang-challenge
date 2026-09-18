import { mapController } from "../map/controller.ts";
import { useUiStore } from "../store/uiStore.ts";
import { useWorldStore } from "../store/worldStore.ts";

export interface GenesisDebugHook {
  selectAgent(id: number | null): void;
  getCamera(): { x: number; y: number; scale: number };
  /** coordenadas de pantalla (relativas al contenedor del mapa) del centro de una celda */
  worldToScreen(x: number, y: number): { x: number; y: number } | null;
  fit(): void;
  /** centra el mapa en una celda (con zoom) */
  panTo(x: number, y: number): void;
  setCamera(camera: { x: number; y: number; scale: number }): void;
  /** viaja a un tick del pasado (o `null` para volver al presente) */
  replay(toTick: number | null): void;
  getState(): { tick: number; liveTick: number; agents: number; ready: boolean; connection: string; replayTick: number | null; replayPending: number | null; groups: number };
}

declare global {
  interface Window {
    __genesis?: GenesisDebugHook;
  }
}

/** Gancho mínimo para pruebas end-to-end (smoke/smoke.mjs). */
export function installDebugHook(): void {
  window.__genesis = {
    selectAgent: (id) => useUiStore.getState().select(id),
    getCamera: () => useUiStore.getState().camera,
    worldToScreen: (x, y) => mapController.worldToScreen(x, y),
    fit: () => mapController.fit(),
    panTo: (x, y) => useUiStore.getState().panTo(x, y),
    setCamera: (camera) => useUiStore.getState().setCamera(camera),
    replay: (toTick) => useWorldStore.getState().requestReplay(toTick),
    getState: () => {
      const s = useWorldStore.getState();
      return {
        tick: s.tick,
        liveTick: s.liveTick,
        agents: s.agents.size,
        ready: s.ready,
        connection: s.connection,
        replayTick: s.replayTick,
        replayPending: s.replayPending,
        groups: s.groups.length,
      };
    },
  };
}
