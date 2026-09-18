/** Puente entre el render del mapa (no React) y el resto de la app. */
export interface MapController {
  fit(): void;
  worldToScreen(x: number, y: number): { x: number; y: number } | null;
}

const noop: MapController = {
  fit: () => {},
  worldToScreen: () => null,
};

export const mapController: MapController = { ...noop };

export function bindMapController(impl: MapController | null): void {
  Object.assign(mapController, impl ?? noop);
}
