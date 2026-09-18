import type { AgentSummary, ResourceKind, Weather } from "@genesis/protocol";
import { RESOURCES } from "@genesis/protocol";
import { RESOURCE_RGBA, STATUS_FILL, TERRAIN_RGB, cssVar } from "../lib/colors.ts";
import { clamp, truncate } from "../lib/format.ts";
import { DEFAULT_TICKS_PER_DAY } from "../lib/time.ts";
import type { Camera, Layers } from "../store/uiStore.ts";
import { useUiStore } from "../store/uiStore.ts";
import { SPEECH_TTL_MS, useWorldStore } from "../store/worldStore.ts";
import { clampCamera, fitCamera, screenToWorld, visibleCells, worldToScreen, zoomAt } from "./camera.ts";
import { bindMapController } from "./controller.ts";
import { STRUCTURE_COLORS, drawStructure } from "./glyphs.ts";
import { computeTerritories } from "./territories.ts";

export const LAYER_NAMES = ["terrain", "resources", "structures", "tint", "agents"] as const;
export type LayerName = (typeof LAYER_NAMES)[number];

export interface TooltipInfo {
  x: number;
  y: number;
  title: string;
  subtitle: string;
}

export interface RendererCallbacks {
  onTooltip(t: TooltipInfo | null): void;
}

interface ResourceImage {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  img: ImageData;
}

const TAU = Math.PI * 2;
const FRAME_MS = 95; // ≈10 fps
const CLICK_RADIUS_TILES = 1.5;
const SELECT_RADIUS_SQ = CLICK_RADIUS_TILES * CLICK_RADIUS_TILES;

const WEATHER_TINT: Partial<Record<Weather, string>> = {
  lluvia: "rgba(40, 60, 95, 0.14)",
  tormenta: "rgba(15, 20, 40, 0.28)",
  nieve: "rgba(220, 230, 245, 0.12)",
  sequia: "rgba(210, 150, 60, 0.10)",
  nublado: "rgba(60, 65, 75, 0.08)",
};

function hashNoise(i: number): number {
  let h = Math.imul(i + 0x9e3779b9, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return (h & 0xff) / 255 - 0.5;
}

function buildTerrainImage(terrain: Uint8Array, size: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const n = size * size;
  for (let i = 0; i < n; i++) {
    const t = terrain[i] ?? 3;
    const rgb = TERRAIN_RGB[t] ?? TERRAIN_RGB[3]!;
    const amp = t <= 1 ? 6 : t === 7 ? 5 : 12;
    const noise = hashNoise(i) * amp;
    const o = i * 4;
    d[o] = clamp(rgb[0] + noise, 0, 255);
    d[o + 1] = clamp(rgb[1] + noise, 0, 255);
    d[o + 2] = clamp(rgb[2] + noise, 0, 255);
    d[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function buildResourceImage(values: Uint8Array, size: number, kind: ResourceKind): ResourceImage {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  const [r, g, b, maxA] = RESOURCE_RGBA[kind];
  const d = img.data;
  const n = size * size;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    d[o] = r;
    d[o + 1] = g;
    d[o + 2] = b;
    d[o + 3] = Math.round((values[i] ?? 0) * maxA);
  }
  ctx.putImageData(img, 0, 0);
  return { canvas, ctx, img };
}

/**
 * Render por capas del mundo. Lee los stores directamente en cada cuadro
 * (≈10 fps) y solo redibuja las capas cuya versión cambió.
 */
export class MapRenderer {
  private dpr = 1;
  private W = 1;
  private H = 1;
  private ctx: Record<LayerName, CanvasRenderingContext2D>;
  private raf = 0;
  private lastFrame = 0;
  private sizeDirty = true;
  private ro: ResizeObserver;

  private terrainImage: HTMLCanvasElement | null = null;
  private terrainVersionSeen = -1;
  private worldSize = 0;
  private fitScale = 1;

  private resourceImages: Record<ResourceKind, ResourceImage> | null = null;
  private resourcesVersionSeen = -1;

  private structuresVersionSeen = -1;
  private agentsVersionSeen = -1;
  private groupsSeen: unknown = null;
  private speechVersionSeen = -1;
  private layersSeen: Layers | null = null;
  private lastCamKey = "";
  private tintKey = "";
  private hoveredSeen: number | null = null;
  private selectedSeen: number | null = null;
  private pickedKey = "";
  private lastPanSeq = 0;
  private animating = false;
  private ping: { x: number; y: number; at: number } | null = null;

  private renderPos = new Map<number, { x: number; y: number }>();
  private drag: { pointerId: number; sx: number; sy: number; camX: number; camY: number; moved: boolean } | null = null;
  private hoverAgent: number | null = null;

  constructor(
    private readonly wrap: HTMLElement,
    canvases: Record<LayerName, HTMLCanvasElement>,
    private readonly cb: RendererCallbacks,
  ) {
    this.ctx = {} as Record<LayerName, CanvasRenderingContext2D>;
    for (const name of LAYER_NAMES) this.ctx[name] = canvases[name].getContext("2d")!;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(wrap);
    this.resize();
    wrap.addEventListener("pointerdown", this.onPointerDown);
    wrap.addEventListener("pointermove", this.onPointerMove);
    wrap.addEventListener("pointerup", this.onPointerUp);
    wrap.addEventListener("pointercancel", this.onPointerUp);
    wrap.addEventListener("pointerleave", this.onPointerLeave);
    wrap.addEventListener("wheel", this.onWheel, { passive: false });
    wrap.addEventListener("dblclick", this.onDblClick);
    bindMapController({
      fit: () => this.fit(),
      worldToScreen: (x, y) => {
        const cam = useUiStore.getState().camera;
        if (cam.scale === 0) return null;
        const [sx, sy] = worldToScreen(cam, this.W, this.H, x, y);
        return { x: sx, y: sy };
      },
    });
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    const w = this.wrap;
    w.removeEventListener("pointerdown", this.onPointerDown);
    w.removeEventListener("pointermove", this.onPointerMove);
    w.removeEventListener("pointerup", this.onPointerUp);
    w.removeEventListener("pointercancel", this.onPointerUp);
    w.removeEventListener("pointerleave", this.onPointerLeave);
    w.removeEventListener("wheel", this.onWheel);
    w.removeEventListener("dblclick", this.onDblClick);
    bindMapController(null);
  }

  // ---------- tamaño y cámara ----------

  private resize(): void {
    const rect = this.wrap.getBoundingClientRect();
    this.W = Math.max(1, Math.floor(rect.width));
    this.H = Math.max(1, Math.floor(rect.height));
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const name of LAYER_NAMES) {
      const c = this.ctx[name].canvas;
      c.width = Math.floor(this.W * this.dpr);
      c.height = Math.floor(this.H * this.dpr);
      c.style.width = `${this.W}px`;
      c.style.height = `${this.H}px`;
    }
    this.sizeDirty = true;
    if (this.worldSize > 0) this.fitScale = fitCamera(this.W, this.H, this.worldSize).scale;
    this.lastFrame = 0;
  }

  fit(): void {
    if (this.worldSize === 0) return;
    const cam = fitCamera(this.W, this.H, this.worldSize);
    this.fitScale = cam.scale;
    useUiStore.getState().setCamera(cam);
  }

  private minScale(): number {
    return this.fitScale * 0.4;
  }

  private setCamera(cam: Camera): void {
    useUiStore.getState().setCamera(clampCamera(cam, this.worldSize, this.minScale()));
  }

  // ---------- entrada ----------

  private localPos(e: MouseEvent): [number, number] {
    const rect = this.wrap.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  /** Los canvas no reciben eventos: si el objetivo no es el contenedor, vino de un control del HUD. */
  private fromMap(e: Event): boolean {
    return e.target === this.wrap;
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 && e.button !== 1) return;
    if (!this.fromMap(e)) return;
    const cam = useUiStore.getState().camera;
    const [sx, sy] = this.localPos(e);
    this.drag = { pointerId: e.pointerId, sx, sy, camX: cam.x, camY: cam.y, moved: false };
    this.wrap.setPointerCapture(e.pointerId);
  };

  private onPointerMove = (e: PointerEvent): void => {
    const [sx, sy] = this.localPos(e);
    if (this.drag && this.drag.pointerId === e.pointerId) {
      const dx = sx - this.drag.sx;
      const dy = sy - this.drag.sy;
      if (!this.drag.moved && Math.hypot(dx, dy) > 3) this.drag.moved = true;
      if (this.drag.moved) {
        const cam = useUiStore.getState().camera;
        this.setCamera({ x: this.drag.camX - dx / cam.scale, y: this.drag.camY - dy / cam.scale, scale: cam.scale });
        this.wrap.style.cursor = "grabbing";
      }
      return;
    }
    if (!this.fromMap(e)) {
      this.setHover(null, sx, sy);
      this.wrap.style.cursor = "default";
      return;
    }
    const ui = useUiStore.getState();
    if (ui.cellPicker) {
      this.wrap.style.cursor = "crosshair";
      this.setHover(null, sx, sy);
      return;
    }
    const id = this.agentAt(sx, sy);
    this.setHover(id, sx, sy);
    this.wrap.style.cursor = id !== null ? "pointer" : "grab";
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.drag || this.drag.pointerId !== e.pointerId) return;
    const d = this.drag;
    this.drag = null;
    try {
      this.wrap.releasePointerCapture(e.pointerId);
    } catch {
      // ya liberado
    }
    this.wrap.style.cursor = "grab";
    if (!d.moved && e.type === "pointerup") this.click(...this.localPos(e));
  };

  private onPointerLeave = (): void => {
    this.setHover(null, 0, 0);
  };

  private onWheel = (e: WheelEvent): void => {
    if (!this.fromMap(e)) return;
    e.preventDefault();
    if (this.worldSize === 0) return;
    const [sx, sy] = this.localPos(e);
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    const factor = Math.exp(-delta * 0.0012);
    const cam = useUiStore.getState().camera;
    this.setCamera(zoomAt(cam, this.W, this.H, sx, sy, factor, this.worldSize, this.minScale()));
  };

  private onDblClick = (e: MouseEvent): void => {
    if (this.worldSize === 0 || !this.fromMap(e)) return;
    const [sx, sy] = this.localPos(e);
    const cam = useUiStore.getState().camera;
    this.setCamera(zoomAt(cam, this.W, this.H, sx, sy, 1.8, this.worldSize, this.minScale()));
  };

  private click(sx: number, sy: number): void {
    if (this.worldSize === 0) return;
    const ui = useUiStore.getState();
    const [wx, wy] = screenToWorld(ui.camera, this.W, this.H, sx, sy);
    const cx = Math.floor(wx);
    const cy = Math.floor(wy);
    const inside = cx >= 0 && cy >= 0 && cx < this.worldSize && cy < this.worldSize;
    if (inside) ui.setPickedCell({ x: cx, y: cy });
    if (ui.cellPicker) {
      ui.setCellPicker(false);
      if (inside) ui.pushToast("info", `Celda elegida: ${cx}, ${cy}`);
      return;
    }
    ui.select(this.agentAt(sx, sy));
  }

  private setHover(id: number | null, sx: number, sy: number): void {
    const ui = useUiStore.getState();
    if (id === this.hoverAgent) return;
    this.hoverAgent = id;
    ui.hover(id);
    if (id === null) {
      this.cb.onTooltip(null);
      return;
    }
    const a = useWorldStore.getState().agents.get(id);
    if (!a) {
      this.cb.onTooltip(null);
      return;
    }
    const [ax, ay] = worldToScreen(ui.camera, this.W, this.H, a.x + 0.5, a.y + 0.5);
    const status = a.alive ? `${a.st} · ${a.act.replace(/_/g, " ")}` : "muerto";
    this.cb.onTooltip({ x: ax, y: ay, title: `${a.name} · #${a.id}`, subtitle: `${status} · ${a.age.toFixed(1)} años` });
    void sx;
    void sy;
  }

  /** El ser más cercano a un punto de pantalla, dentro de ~1.5 celdas. */
  private agentAt(sx: number, sy: number): number | null {
    const ui = useUiStore.getState();
    if (ui.camera.scale === 0) return null;
    const [wx, wy] = screenToWorld(ui.camera, this.W, this.H, sx, sy);
    let best: number | null = null;
    let bestD = SELECT_RADIUS_SQ;
    // en píxeles también aceptamos un radio mínimo de 8 px para mapas muy alejados
    const pxRadiusTiles = 8 / ui.camera.scale;
    const maxD = Math.max(bestD, pxRadiusTiles * pxRadiusTiles);
    bestD = maxD;
    for (const a of useWorldStore.getState().agents.values()) {
      const dx = a.x + 0.5 - wx;
      const dy = a.y + 0.5 - wy;
      const d = dx * dx + dy * dy;
      if (d < bestD || (d === bestD && best !== null && a.alive)) {
        bestD = d;
        best = a.id;
      }
    }
    return best;
  }

  // ---------- cuadro ----------

  private frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    if (now - this.lastFrame < FRAME_MS) return;
    this.lastFrame = now;
    try {
      this.draw(now);
    } catch (err) {
      console.error("render del mapa", err);
    }
  };

  private draw(now: number): void {
    const ws = useWorldStore.getState();
    const ui = useUiStore.getState();
    if (!ws.world || !ws.terrain) return;
    const size = ws.world.size;
    if (size !== this.worldSize) {
      this.worldSize = size;
      this.fitScale = fitCamera(this.W, this.H, size).scale;
      this.terrainImage = null;
      this.resourceImages = null;
      this.renderPos.clear();
      if (ui.camera.scale === 0) this.fit();
    } else if (ui.camera.scale === 0) {
      this.fit();
    }

    if (ui.panRequest && ui.panRequest.seq !== this.lastPanSeq) {
      this.lastPanSeq = ui.panRequest.seq;
      const cam = useUiStore.getState().camera;
      const scale = Math.max(cam.scale, Math.min(12, this.fitScale * 3));
      this.setCamera({ x: ui.panRequest.x + 0.5, y: ui.panRequest.y + 0.5, scale });
      this.ping = { x: ui.panRequest.x + 0.5, y: ui.panRequest.y + 0.5, at: now };
    }

    const cam = useUiStore.getState().camera;
    const camKey = `${cam.x.toFixed(3)},${cam.y.toFixed(3)},${cam.scale.toFixed(4)}`;
    const camChanged = camKey !== this.lastCamKey || this.sizeDirty;
    const layersChanged = ui.layers !== this.layersSeen;
    const agentsChanged = ws.agentsVersion !== this.agentsVersionSeen;
    const groupsChanged = ws.groups !== this.groupsSeen;

    // terreno
    if (ws.terrainVersion !== this.terrainVersionSeen || !this.terrainImage) {
      this.terrainImage = buildTerrainImage(ws.terrain, size);
      this.terrainVersionSeen = ws.terrainVersion;
      this.drawTerrain(cam);
    } else if (camChanged) {
      this.drawTerrain(cam);
    }

    // recursos
    let resourcesChanged = false;
    if (ws.resources && (ws.resourcesVersion !== this.resourcesVersionSeen || !this.resourceImages)) {
      const jump = ws.resourcesVersion - this.resourcesVersionSeen;
      if (!this.resourceImages || jump !== 1 || ws.resourcePatches.length === 0) {
        const images = {} as Record<ResourceKind, ResourceImage>;
        for (const r of RESOURCES) images[r] = buildResourceImage(ws.resources[r], size, r);
        this.resourceImages = images;
      } else {
        const dirty = new Set<ResourceKind>();
        for (const [cell, kind, v] of ws.resourcePatches) {
          const im = this.resourceImages[kind];
          if (!im || cell < 0 || cell * 4 + 3 >= im.img.data.length) continue;
          im.img.data[cell * 4 + 3] = Math.round(v * RESOURCE_RGBA[kind][3]);
          dirty.add(kind);
        }
        for (const kind of dirty) this.resourceImages[kind].ctx.putImageData(this.resourceImages[kind].img, 0, 0);
      }
      this.resourcesVersionSeen = ws.resourcesVersion;
      resourcesChanged = true;
    }
    if (this.resourceImages && (camChanged || resourcesChanged || layersChanged)) this.drawResources(cam, ui.layers, ws.resources!);

    // estructuras (+ territorios)
    const territoriesLive = ui.layers.territories && ws.groups.length > 0 && agentsChanged;
    if (camChanged || ws.structuresVersion !== this.structuresVersionSeen || layersChanged || groupsChanged || territoriesLive) {
      this.drawStructures(cam, ui.layers);
      this.structuresVersionSeen = ws.structuresVersion;
      this.groupsSeen = ws.groups;
    }

    // tinte día/noche + clima
    const daylight = ui.layers.dayNight ? (ws.clock?.daylight ?? 1) : 1;
    const tintKey = `${Math.round(daylight * 40)}|${ui.layers.dayNight ? (ws.climate?.weather ?? "") : ""}`;
    if (tintKey !== this.tintKey || this.sizeDirty) {
      this.drawTint(daylight, ui.layers.dayNight ? ws.climate?.weather : undefined);
      this.tintKey = tintKey;
    }

    // seres (cada cuadro si algo se mueve)
    const speechChanged = ws.speechVersion !== this.speechVersionSeen;
    const pickedKey = `${ui.pickedCell?.x ?? "-"},${ui.pickedCell?.y ?? "-"},${ui.cellPicker}`;
    const pingActive = this.ping !== null && now - this.ping.at < 1400;
    const transient = ws.speech.size > 0 || this.animating || pingActive;
    if (
      camChanged ||
      agentsChanged ||
      layersChanged ||
      speechChanged ||
      transient ||
      ui.hoveredId !== this.hoveredSeen ||
      ui.selectedId !== this.selectedSeen ||
      pickedKey !== this.pickedKey ||
      groupsChanged
    ) {
      this.drawAgents(cam, ui, now);
      this.agentsVersionSeen = ws.agentsVersion;
      this.speechVersionSeen = ws.speechVersion;
      this.hoveredSeen = ui.hoveredId;
      this.selectedSeen = ui.selectedId;
      this.pickedKey = pickedKey;
    }

    this.lastCamKey = camKey;
    this.layersSeen = ui.layers;
    this.sizeDirty = false;
  }

  private begin(name: LayerName): CanvasRenderingContext2D {
    const ctx = this.ctx[name];
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalAlpha = 1;
    return ctx;
  }

  private drawTerrain(cam: Camera): void {
    const ctx = this.begin("terrain");
    if (!this.terrainImage) return;
    const size = this.worldSize;
    const [ox, oy] = worldToScreen(cam, this.W, this.H, 0, 0);
    const px = size * cam.scale;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(ox + 3, oy + 3, px, px);
    ctx.drawImage(this.terrainImage, ox, oy, px, px);
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    ctx.strokeRect(ox - 0.5, oy - 0.5, px + 1, px + 1);
  }

  private drawResources(cam: Camera, layers: Layers, resources: Record<ResourceKind, Uint8Array>): void {
    const ctx = this.begin("resources");
    if (!this.resourceImages) return;
    const size = this.worldSize;
    const [ox, oy] = worldToScreen(cam, this.W, this.H, 0, 0);
    const px = size * cam.scale;
    ctx.imageSmoothingEnabled = false;
    for (const r of RESOURCES) {
      if (!layers.resources[r]) continue;
      ctx.drawImage(this.resourceImages[r].canvas, ox, oy, px, px);
    }
    // destellos de mineral y gemas cuando hay zoom
    if (cam.scale >= 7) {
      const vis = visibleCells(cam, this.W, this.H, size);
      const sparkle = (kind: ResourceKind, color: string, rot: number) => {
        if (!layers.resources[kind]) return;
        const arr = resources[kind];
        ctx.fillStyle = color;
        ctx.strokeStyle = "rgba(0,0,0,0.5)";
        ctx.lineWidth = 1;
        const rad = Math.max(2, cam.scale * 0.22);
        for (let y = vis.y0; y < vis.y1; y++) {
          for (let x = vis.x0; x < vis.x1; x++) {
            const v = arr[y * size + x] ?? 0;
            if (v < 40) continue;
            const [sx, sy] = worldToScreen(cam, this.W, this.H, x + 0.5, y + 0.5);
            const rr = rad * (0.6 + 0.4 * (v / 255));
            ctx.save();
            ctx.translate(sx, sy);
            ctx.rotate(rot);
            ctx.beginPath();
            ctx.moveTo(0, -rr);
            ctx.lineTo(rr, 0);
            ctx.lineTo(0, rr);
            ctx.lineTo(-rr, 0);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();
          }
        }
      };
      sparkle("mineral", "#9ec8ff", 0);
      sparkle("gema", "#ff8fe6", Math.PI / 4);
    }
  }

  private drawStructures(cam: Camera, layers: Layers): void {
    const ctx = this.begin("structures");
    const ws = useWorldStore.getState();
    if (layers.territories && ws.groups.length) {
      const labels: Array<{ x: number; y: number; w: number; text: string; color: string }> = [];
      for (const t of computeTerritories(ws.groups, ws.agents)) {
        ctx.beginPath();
        t.hull.forEach(([x, y], i) => {
          const [sx, sy] = worldToScreen(cam, this.W, this.H, x, y);
          if (i === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        });
        ctx.closePath();
        ctx.fillStyle = t.color;
        ctx.globalAlpha = 0.12;
        ctx.fill();
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = t.color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.globalAlpha = 1;
        const [cx, cy] = worldToScreen(cam, this.W, this.H, t.centroid[0], t.centroid[1]);
        labels.push({ x: cx, y: cy, w: 0, text: t.name, color: t.color });
      }
      // etiquetas: si dos tribus vecinas se pisan, la segunda baja un renglón
      ctx.font = "600 11px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const placed: Array<{ x: number; y: number; w: number }> = [];
      for (const l of labels) {
        l.w = ctx.measureText(l.text).width + 10;
        for (let tries = 0; tries < 6; tries++) {
          const hit = placed.some((p) => Math.abs(p.x - l.x) < (p.w + l.w) / 2 && Math.abs(p.y - l.y) < 14);
          if (!hit) break;
          l.y += 14;
        }
        placed.push({ x: l.x, y: l.y, w: l.w });
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(0,0,0,0.7)";
        ctx.strokeText(l.text, l.x, l.y);
        ctx.fillStyle = "#fff";
        ctx.fillText(l.text, l.x, l.y);
      }
    }
    if (!layers.structures) return;
    const margin = 40;
    const tiny = cam.scale < 3.5;
    const s = clamp(cam.scale, 7, 44);
    for (const st of ws.structures.values()) {
      const [sx, sy] = worldToScreen(cam, this.W, this.H, st.x + 0.5, st.y + 0.5);
      if (sx < -margin || sy < -margin || sx > this.W + margin || sy > this.H + margin) continue;
      if (tiny) {
        ctx.fillStyle = STRUCTURE_COLORS[st.kind];
        ctx.globalAlpha = st.progress < 1 ? 0.5 : 1;
        ctx.fillRect(sx - 1.5, sy - 1.5, 3, 3);
        ctx.globalAlpha = 1;
        continue;
      }
      drawStructure(ctx, st, sx, sy, s);
    }
  }

  private drawTint(daylight: number, weather: Weather | undefined): void {
    const ctx = this.begin("tint");
    const night = clamp(1 - daylight, 0, 1);
    if (night > 0.01) {
      ctx.fillStyle = `rgba(8, 16, 48, ${(night * 0.5).toFixed(3)})`;
      ctx.fillRect(0, 0, this.W, this.H);
    }
    const wt = weather ? WEATHER_TINT[weather] : undefined;
    if (wt) {
      ctx.fillStyle = wt;
      ctx.fillRect(0, 0, this.W, this.H);
    }
  }

  private drawAgents(cam: Camera, ui: ReturnType<typeof useUiStore.getState>, now: number): void {
    const ctx = this.begin("agents");
    const ws = useWorldStore.getState();
    const tpd = ws.world?.ticksPerDay ?? DEFAULT_TICKS_PER_DAY;
    const accent = cssVar("--accent", "#e0b25c");
    const r = clamp(cam.scale * 0.36, 2.5, 10);
    const margin = 30;
    let animating = false;

    // posiciones suavizadas
    const visible: Array<{ a: AgentSummary; sx: number; sy: number }> = [];
    const seen = new Set<number>();
    for (const a of ws.agents.values()) {
      seen.add(a.id);
      let rp = this.renderPos.get(a.id);
      if (!rp) {
        rp = { x: a.x, y: a.y };
        this.renderPos.set(a.id, rp);
      } else if (a.alive) {
        const dx = a.x - rp.x;
        const dy = a.y - rp.y;
        if (Math.abs(dx) > 0.02 || Math.abs(dy) > 0.02) {
          if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
            rp.x = a.x;
            rp.y = a.y;
          } else {
            rp.x += dx * 0.5;
            rp.y += dy * 0.5;
            animating = true;
          }
        } else {
          rp.x = a.x;
          rp.y = a.y;
        }
      }
      const [sx, sy] = worldToScreen(cam, this.W, this.H, rp.x + 0.5, rp.y + 0.5);
      if (sx < -margin || sy < -margin || sx > this.W + margin || sy > this.H + margin) continue;
      visible.push({ a, sx, sy });
    }
    if (this.renderPos.size > seen.size + 50) for (const id of this.renderPos.keys()) if (!seen.has(id)) this.renderPos.delete(id);
    this.animating = animating;

    // celda elegida
    if (ui.pickedCell) {
      const [px, py] = worldToScreen(cam, this.W, this.H, ui.pickedCell.x, ui.pickedCell.y);
      const s = Math.max(6, cam.scale);
      ctx.strokeStyle = accent;
      ctx.lineWidth = ui.cellPicker ? 2 : 1.25;
      ctx.globalAlpha = ui.cellPicker ? 1 : 0.7;
      ctx.strokeRect(px - (s - cam.scale) / 2, py - (s - cam.scale) / 2, s, s);
      if (ui.cellPicker) {
        ctx.beginPath();
        ctx.moveTo(px + cam.scale / 2, py - 10);
        ctx.lineTo(px + cam.scale / 2, py + s + 10);
        ctx.moveTo(px - 10, py + cam.scale / 2);
        ctx.lineTo(px + s + 10, py + cam.scale / 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    if (!ui.layers.agents) return;

    const drawOne = (a: AgentSummary, sx: number, sy: number) => {
      const dead = !a.alive || a.st === "muerto";
      let alpha = 1;
      if (dead) {
        const t = ws.deaths.get(a.id) ?? ws.tick;
        alpha = clamp(1 - (0.75 * (ws.tick - t)) / tpd, 0.25, 1);
      }
      ctx.globalAlpha = alpha;
      if (a.g !== null) {
        const gc = ws.groupColors.get(a.g);
        if (gc) {
          ctx.fillStyle = gc;
          ctx.beginPath();
          ctx.arc(sx, sy, r + 2, 0, TAU);
          ctx.fill();
        }
      }
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, TAU);
      ctx.fillStyle = STATUS_FILL[a.st] ?? STATUS_FILL.activo;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.stroke();
      if (dead) {
        ctx.strokeStyle = "rgba(20,20,20,0.9)";
        ctx.lineWidth = Math.max(1, r * 0.3);
        const k = r * 0.55;
        ctx.beginPath();
        ctx.moveTo(sx - k, sy - k);
        ctx.lineTo(sx + k, sy + k);
        ctx.moveTo(sx + k, sy - k);
        ctx.lineTo(sx - k, sy + k);
        ctx.stroke();
      }
      if (a.id === ui.hoveredId && a.id !== ui.selectedId) {
        ctx.strokeStyle = "rgba(255,255,255,0.95)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(sx, sy, r + 2.5, 0, TAU);
        ctx.stroke();
      }
      if (a.id === ui.selectedId) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sx, sy, r + 3.5, 0, TAU);
        ctx.stroke();
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(sx, sy, r + 6.5, 0, TAU);
        ctx.stroke();
      }
      if (ui.layers.names && cam.scale >= 14 && a.alive) {
        ctx.font = "500 10px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(0,0,0,0.75)";
        ctx.strokeText(a.name, sx, sy + r + 2);
        ctx.fillStyle = "#f4f4f4";
        ctx.fillText(a.name, sx, sy + r + 2);
      }
      ctx.globalAlpha = 1;
    };

    for (const v of visible) if (!v.a.alive) drawOne(v.a, v.sx, v.sy);
    let selected: { a: AgentSummary; sx: number; sy: number } | null = null;
    for (const v of visible) {
      if (!v.a.alive) continue;
      if (v.a.id === ui.selectedId) {
        selected = v;
        continue;
      }
      drawOne(v.a, v.sx, v.sy);
    }
    if (selected) drawOne(selected.a, selected.sx, selected.sy);

    // globos de habla (los más recientes primero; se apilan si se solapan)
    if (ws.speech.size) {
      ctx.font = "11px system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      const bubbles: Array<{ v: { a: AgentSummary; sx: number; sy: number }; at: number; text: string }> = [];
      for (const v of visible) {
        const b = ws.speech.get(v.a.id);
        if (!b || now - b.at > SPEECH_TTL_MS) continue;
        bubbles.push({ v, at: b.at, text: b.text });
      }
      bubbles.sort((p, q) => q.at - p.at);
      const placed: Array<{ x: number; y: number; w: number; h: number }> = [];
      for (const { v, at, text: raw } of bubbles.slice(0, 14)) {
        const age = now - at;
        const fade = age > SPEECH_TTL_MS - 1000 ? (SPEECH_TTL_MS - age) / 1000 : 1;
        const text = truncate(raw, 64);
        const w = ctx.measureText(text).width + 14;
        const h = 20;
        const x = clamp(v.sx - w / 2, 4, this.W - w - 4);
        let y = v.sy - r - 12 - h;
        for (let tries = 0; tries < 8; tries++) {
          const hit = placed.some((p) => x < p.x + p.w + 4 && x + w + 4 > p.x && y < p.y + p.h + 3 && y + h + 3 > p.y);
          if (!hit) break;
          y -= h + 4;
        }
        placed.push({ x, y, w, h });
        ctx.globalAlpha = 0.94 * fade;
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 6);
        ctx.fill();
        const tailX = clamp(v.sx, x + 8, x + w - 8);
        ctx.beginPath();
        ctx.moveTo(tailX - 5, y + h);
        ctx.lineTo(tailX + 5, y + h);
        ctx.lineTo(tailX, y + h + 6);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#15181c";
        ctx.fillText(text, x + 7, y + h / 2 + 0.5);
        ctx.globalAlpha = 1;
      }
    }

    // marca del salto de cámara
    if (this.ping) {
      const t = (now - this.ping.at) / 1400;
      if (t < 1) {
        const [px, py] = worldToScreen(cam, this.W, this.H, this.ping.x, this.ping.y);
        ctx.strokeStyle = accent;
        ctx.globalAlpha = 1 - t;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py, 6 + 34 * t, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else {
        this.ping = null;
      }
    }
  }
}
