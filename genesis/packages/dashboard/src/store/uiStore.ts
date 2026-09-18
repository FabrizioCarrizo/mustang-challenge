import type { ResourceKind } from "@genesis/protocol";
import { create } from "zustand";
import { socket } from "../lib/ws.ts";

export type Tab = "ser" | "sociedad" | "cronica" | "metricas" | "dios";
export type AgentSubTab = "mente" | "relaciones" | "conversaciones" | "familia" | "pensamientos";

export interface Camera {
  /** coordenada del mundo (en celdas) que está en el centro de la vista */
  x: number;
  y: number;
  /** píxeles CSS por celda; 0 = todavía no ajustada */
  scale: number;
}

export interface Layers {
  resources: Record<ResourceKind, boolean>;
  structures: boolean;
  territories: boolean;
  agents: boolean;
  names: boolean;
  dayNight: boolean;
}

export interface Toast {
  id: number;
  level: "info" | "warn" | "error";
  text: string;
  at: number;
}

export interface NoticeEntry {
  id: number;
  level: "info" | "warn" | "error";
  text: string;
  at: number;
  tick: number;
}

/** Un acto divino enviado y, cuando llega, la respuesta del servidor. */
export interface GodAct {
  id: number;
  at: number;
  label: string;
  result: string | null;
  ok: boolean | null;
}

export const NOTICE_LOG_SIZE = 20;
export const GOD_LOG_SIZE = 8;

export interface Cell {
  x: number;
  y: number;
}

export type ThemeMode = "auto" | "dark" | "light";

interface UiState {
  selectedId: number | null;
  hoveredId: number | null;
  camera: Camera;
  layers: Layers;
  tab: Tab;
  agentSubTab: AgentSubTab;
  panelOpen: boolean;
  cellPicker: boolean;
  pickedCell: Cell | null;
  /** pedido de centrar el mapa; `seq` cambia en cada pedido */
  panRequest: { x: number; y: number; seq: number } | null;
  toasts: Toast[];
  /** últimos avisos del servidor (campana) */
  notices: NoticeEntry[];
  noticesOpen: boolean;
  unreadNotices: number;
  /** últimos actos divinos enviados desde este panel */
  godActs: GodAct[];
  theme: ThemeMode;

  select(id: number | null, opts?: { focusTab?: boolean }): void;
  hover(id: number | null): void;
  setCamera(c: Camera): void;
  toggleLayer(key: Exclude<keyof Layers, "resources">): void;
  toggleResource(kind: ResourceKind): void;
  setTab(t: Tab): void;
  setAgentSubTab(t: AgentSubTab): void;
  togglePanel(): void;
  setCellPicker(on: boolean): void;
  setPickedCell(c: Cell | null): void;
  panTo(x: number, y: number): void;
  pushToast(level: Toast["level"], text: string): void;
  dismissToast(id: number): void;
  /** guarda un aviso en la campana (sin toast) */
  logNotice(level: Toast["level"], text: string, tick: number): void;
  toggleNotices(open?: boolean): void;
  pushGodAct(label: string): void;
  resolveGodAct(result: string, ok: boolean): void;
  setTheme(t: ThemeMode): void;
}

let toastSeq = 0;
let panSeq = 0;
let noticeSeq = 0;
let godSeq = 0;

function readTheme(): ThemeMode {
  try {
    const v = localStorage.getItem("genesis.theme");
    return v === "dark" || v === "light" ? v : "auto";
  } catch {
    return "auto";
  }
}

export function applyTheme(t: ThemeMode): void {
  const root = document.documentElement;
  if (t === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", t);
}

export const useUiStore = create<UiState>()((set, get) => ({
  selectedId: null,
  hoveredId: null,
  camera: { x: 0, y: 0, scale: 0 },
  layers: {
    resources: { comida: true, madera: true, piedra: false, mineral: true, gema: true },
    structures: true,
    territories: true,
    agents: true,
    names: true,
    dayNight: true,
  },
  tab: "ser",
  agentSubTab: "mente",
  panelOpen: true,
  cellPicker: false,
  pickedCell: null,
  panRequest: null,
  toasts: [],
  notices: [],
  noticesOpen: false,
  unreadNotices: 0,
  godActs: [],
  theme: readTheme(),

  select(id, opts) {
    const prev = get().selectedId;
    if (prev === id) {
      if (id !== null && opts?.focusTab !== false) set({ tab: "ser", panelOpen: true });
      return;
    }
    set({ selectedId: id, ...(id !== null && opts?.focusTab !== false ? { tab: "ser" as Tab, panelOpen: true } : {}) });
    socket.send({ t: "subscribe", agentId: id });
  },

  hover(id) {
    if (get().hoveredId !== id) set({ hoveredId: id });
  },

  setCamera(camera) {
    set({ camera });
  },

  toggleLayer(key) {
    const layers = get().layers;
    set({ layers: { ...layers, [key]: !layers[key] } });
  },

  toggleResource(kind) {
    const layers = get().layers;
    set({ layers: { ...layers, resources: { ...layers.resources, [kind]: !layers.resources[kind] } } });
  },

  setTab(tab) {
    set({ tab, panelOpen: true });
  },

  setAgentSubTab(agentSubTab) {
    set({ agentSubTab });
  },

  togglePanel() {
    set({ panelOpen: !get().panelOpen });
  },

  setCellPicker(cellPicker) {
    set({ cellPicker });
  },

  setPickedCell(pickedCell) {
    set({ pickedCell });
  },

  panTo(x, y) {
    set({ panRequest: { x, y, seq: ++panSeq } });
  },

  pushToast(level, text) {
    const toast: Toast = { id: ++toastSeq, level, text, at: Date.now() };
    const toasts = get().toasts.concat(toast).slice(-5);
    set({ toasts });
    window.setTimeout(() => get().dismissToast(toast.id), level === "error" ? 9000 : 5500);
  },

  dismissToast(id) {
    const toasts = get().toasts;
    if (toasts.some((t) => t.id === id)) set({ toasts: toasts.filter((t) => t.id !== id) });
  },

  logNotice(level, text, tick) {
    const entry: NoticeEntry = { id: ++noticeSeq, level, text, at: Date.now(), tick };
    const s = get();
    set({
      notices: [entry, ...s.notices].slice(0, NOTICE_LOG_SIZE),
      unreadNotices: s.noticesOpen ? 0 : Math.min(99, s.unreadNotices + 1),
    });
  },

  toggleNotices(open) {
    const next = open ?? !get().noticesOpen;
    set({ noticesOpen: next, unreadNotices: next ? 0 : get().unreadNotices });
  },

  pushGodAct(label) {
    const act: GodAct = { id: ++godSeq, at: Date.now(), label, result: null, ok: null };
    set({ godActs: [act, ...get().godActs].slice(0, GOD_LOG_SIZE) });
  },

  resolveGodAct(result, ok) {
    const acts = get().godActs;
    const idx = acts.findIndex((a) => a.result === null);
    if (idx < 0) return;
    const next = acts.slice();
    next[idx] = { ...acts[idx]!, result, ok };
    set({ godActs: next });
  },

  setTheme(theme) {
    try {
      localStorage.setItem("genesis.theme", theme);
    } catch {
      // sin almacenamiento: el tema vive solo en esta sesión
    }
    applyTheme(theme);
    set({ theme });
  },
}));
