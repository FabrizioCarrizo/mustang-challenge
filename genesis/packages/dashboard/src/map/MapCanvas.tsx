import { RESOURCES } from "@genesis/protocol";
import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { RESOURCE_CSS } from "../lib/colors.ts";
import { RESOURCE_LABELS, WEATHER_LABELS } from "../lib/labels.ts";
import { useUiStore } from "../store/uiStore.ts";
import { useWorldStore } from "../store/worldStore.ts";
import { mapController } from "./controller.ts";
import { LAYER_NAMES, MapRenderer, type LayerName, type TooltipInfo } from "./renderer.ts";

export function MapCanvas() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef<Partial<Record<LayerName, HTMLCanvasElement>>>({});
  const [tooltip, setTooltip] = useState<TooltipInfo | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const canvases = {} as Record<LayerName, HTMLCanvasElement>;
    for (const name of LAYER_NAMES) {
      const c = canvasRefs.current[name];
      if (!c) return;
      canvases[name] = c;
    }
    const renderer = new MapRenderer(wrap, canvases, { onTooltip: setTooltip });
    return () => renderer.destroy();
  }, []);

  return (
    <div className="map-wrap" ref={wrapRef} data-testid="map">
      {LAYER_NAMES.map((name) => (
        <canvas
          key={name}
          className={`map-layer map-layer-${name}`}
          ref={(el) => {
            if (el) canvasRefs.current[name] = el;
          }}
        />
      ))}
      {tooltip && (
        <div className="map-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
          <div className="map-tooltip__title">{tooltip.title}</div>
          <div className="map-tooltip__sub">{tooltip.subtitle}</div>
        </div>
      )}
      <MapHud />
      <WeatherBadge />
      <PickerBanner />
    </div>
  );
}

function MapHud() {
  const layers = useUiStore((s) => s.layers);
  const toggleLayer = useUiStore((s) => s.toggleLayer);
  const toggleResource = useUiStore((s) => s.toggleResource);
  const [open, setOpen] = useState(false);
  return (
    <div className="map-hud">
      <div className="map-hud__row">
        <button className="btn btn--sm" onClick={() => setOpen((o) => !o)} title="Capas del mapa" aria-expanded={open}>
          Capas
        </button>
        <button className="btn btn--sm" onClick={() => mapController.fit()} title="Ajustar el mapa a la vista">
          Centrar
        </button>
      </div>
      {open && (
        <div className="map-hud__panel">
          <div className="map-hud__group">
            {RESOURCES.map((r) => (
              <label key={r} className="check">
                <input type="checkbox" checked={layers.resources[r]} onChange={() => toggleResource(r)} />
                <span className="swatch" style={{ background: RESOURCE_CSS[r] }} />
                {RESOURCE_LABELS[r]}
              </label>
            ))}
          </div>
          <div className="map-hud__group">
            <label className="check">
              <input type="checkbox" checked={layers.structures} onChange={() => toggleLayer("structures")} /> Estructuras
            </label>
            <label className="check">
              <input type="checkbox" checked={layers.territories} onChange={() => toggleLayer("territories")} /> Territorios
            </label>
            <label className="check">
              <input type="checkbox" checked={layers.agents} onChange={() => toggleLayer("agents")} /> Seres
            </label>
            <label className="check">
              <input type="checkbox" checked={layers.names} onChange={() => toggleLayer("names")} /> Nombres (con zoom)
            </label>
            <label className="check">
              <input type="checkbox" checked={layers.dayNight} onChange={() => toggleLayer("dayNight")} /> Día / noche
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

function WeatherBadge() {
  const { climate, clock } = useWorldStore(useShallow((s) => ({ climate: s.climate, clock: s.clock })));
  if (!climate || !clock) return null;
  const w = WEATHER_LABELS[climate.weather] ?? { icon: "", label: climate.weather };
  const night = !clock.isDay;
  return (
    <div className={`map-weather${night ? " map-weather--night" : ""}`} title={climate.drought ? "sequía en curso" : undefined}>
      <span className="map-weather__icon" aria-hidden>
        {w.icon}
      </span>
      <span>{w.label}</span>
      <span className="num">{climate.temperature.toFixed(1)}°</span>
      <span className="muted">{night ? "noche" : "día"}</span>
      {climate.drought && <span className="badge badge--warn">sequía</span>}
    </div>
  );
}

function PickerBanner() {
  const cellPicker = useUiStore((s) => s.cellPicker);
  const setCellPicker = useUiStore((s) => s.setCellPicker);
  if (!cellPicker) return null;
  return (
    <div className="map-banner">
      Hacé clic en el mapa para elegir la celda objetivo
      <button className="btn btn--sm" onClick={() => setCellPicker(false)}>
        cancelar
      </button>
    </div>
  );
}
