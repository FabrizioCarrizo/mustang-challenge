import type { Camera } from "../store/uiStore.ts";

export const MAX_SCALE = 64;

export function worldToScreen(cam: Camera, W: number, H: number, wx: number, wy: number): [number, number] {
  return [(wx - cam.x) * cam.scale + W / 2, (wy - cam.y) * cam.scale + H / 2];
}

export function screenToWorld(cam: Camera, W: number, H: number, sx: number, sy: number): [number, number] {
  return [(sx - W / 2) / cam.scale + cam.x, (sy - H / 2) / cam.scale + cam.y];
}

export function fitCamera(W: number, H: number, size: number): Camera {
  const scale = Math.max(0.5, (Math.min(W, H) / size) * 0.96);
  return { x: size / 2, y: size / 2, scale };
}

export function clampCamera(cam: Camera, size: number, minScale: number): Camera {
  const scale = Math.min(MAX_SCALE, Math.max(minScale, cam.scale));
  const x = Math.min(size, Math.max(0, cam.x));
  const y = Math.min(size, Math.max(0, cam.y));
  return { x, y, scale };
}

/** Zoom alrededor de un punto de pantalla, manteniendo fijo lo que hay bajo el cursor. */
export function zoomAt(cam: Camera, W: number, H: number, sx: number, sy: number, factor: number, size: number, minScale: number): Camera {
  const [wx, wy] = screenToWorld(cam, W, H, sx, sy);
  const scale = Math.min(MAX_SCALE, Math.max(minScale, cam.scale * factor));
  const x = wx - (sx - W / 2) / scale;
  const y = wy - (sy - H / 2) / scale;
  return clampCamera({ x, y, scale }, size, minScale);
}

/** Rango de celdas visibles (inclusive/exclusive) para no iterar todo el mundo. */
export function visibleCells(cam: Camera, W: number, H: number, size: number): { x0: number; y0: number; x1: number; y1: number } {
  const [wx0, wy0] = screenToWorld(cam, W, H, 0, 0);
  const [wx1, wy1] = screenToWorld(cam, W, H, W, H);
  return {
    x0: Math.max(0, Math.floor(wx0) - 1),
    y0: Math.max(0, Math.floor(wy0) - 1),
    x1: Math.min(size, Math.ceil(wx1) + 1),
    y1: Math.min(size, Math.ceil(wy1) + 1),
  };
}
