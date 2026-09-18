import type { MetricsPoint } from "@genesis/protocol";
import { useEffect, useMemo, useState } from "react";
import { LineChart } from "../charts/LineChart.tsx";
import { useThemeKey } from "../charts/theme.ts";
import { Empty } from "../components/ui.tsx";
import { apiGet } from "../lib/api.ts";
import { fmtNum, fmtUsd } from "../lib/format.ts";
import { NEED_LABELS } from "../lib/labels.ts";
import { useWorldStore } from "../store/worldStore.ts";

const RANGES: Array<{ points: number; label: string }> = [
  { points: 288, label: "2 días" },
  { points: 1008, label: "7 días" },
  { points: 0, label: "todo" },
];

const fmtInt = (v: number) => fmtNum(v, 0);
const fmt1 = (v: number) => v.toFixed(1);
const fmt2 = (v: number) => v.toFixed(2);
const fmtMoney = (v: number) => fmtUsd(v, 2);

export function MetricsPanel() {
  const metrics = useWorldStore((s) => s.metrics);
  const mergeMetrics = useWorldStore((s) => s.mergeMetrics);
  const budget = useWorldStore((s) => s.budget);
  const tpd = useWorldStore((s) => s.world?.ticksPerDay ?? 144);
  const themeKey = useThemeKey();
  const [range, setRange] = useState(288);

  useEffect(() => {
    const ctrl = new AbortController();
    void apiGet<MetricsPoint[]>("/metrics?limit=288", ctrl.signal).then((r) => {
      if (r.status === "ok" && r.data.length) mergeMetrics(r.data);
    });
    return () => ctrl.abort();
  }, [mergeMetrics]);

  const view = useMemo(() => (range > 0 ? metrics.slice(-range) : metrics), [metrics, range]);
  const x = useMemo(() => view.map((p) => p.tick), [view]);
  const cols = useMemo(
    () => ({
      population: view.map((p) => p.population),
      births: view.map((p) => p.births),
      deaths: view.map((p) => p.deaths),
      sed: view.map((p) => p.avgNeeds.sed),
      hambre: view.map((p) => p.avgNeeds.hambre),
      calor: view.map((p) => p.avgNeeds.calor),
      social: view.map((p) => p.avgNeeds.social),
      sentido: view.map((p) => p.avgNeeds.sentido),
      gini: view.map((p) => p.gini),
      usd: view.map((p) => p.usd),
    }),
    [view],
  );
  const populationSeries = useMemo(() => [{ label: "población", values: cols.population, slot: 0 }], [cols]);
  const birthsSeries = useMemo(
    () => [
      { label: "nacimientos", values: cols.births, slot: 0 },
      { label: "muertes", values: cols.deaths, slot: 1 },
    ],
    [cols],
  );
  const needsSeries = useMemo(
    () => [
      { label: NEED_LABELS.sed.toLowerCase(), values: cols.sed, slot: 0 },
      { label: NEED_LABELS.hambre.toLowerCase(), values: cols.hambre, slot: 1 },
      { label: NEED_LABELS.calor.toLowerCase(), values: cols.calor, slot: 2 },
      { label: NEED_LABELS.social.toLowerCase(), values: cols.social, slot: 3 },
      { label: NEED_LABELS.sentido.toLowerCase(), values: cols.sentido, slot: 4 },
    ],
    [cols],
  );
  const giniSeries = useMemo(() => [{ label: "gini", values: cols.gini, slot: 0 }], [cols]);
  const usdSeries = useMemo(() => [{ label: "USD", values: cols.usd, slot: 0 }], [cols]);
  const unit: [number, number] = useMemo(() => [0, 1], []);

  const last = metrics.length ? metrics[metrics.length - 1]! : null;

  return (
    <div className="metrics" data-testid="metrics-panel">
      <div className="stats">
        <Stat label="población" value={last ? fmtInt(last.population) : "—"} />
        <Stat label="nacimientos hoy" value={last ? fmtInt(last.births) : "—"} />
        <Stat label="muertes hoy" value={last ? fmtInt(last.deaths) : "—"} />
        <Stat label="gini" value={last ? fmt2(last.gini) : "—"} />
        <Stat label="violencia hoy" value={last ? fmtInt(last.violence) : "—"} />
        <Stat label="USD hoy" value={budget ? fmtUsd(budget.usdToday) : last ? fmtUsd(last.usd) : "—"} />
      </div>

      <div className="toolbar">
        <span className="muted">rango</span>
        <div className="segmented" role="group" aria-label="rango temporal">
          {RANGES.map((r) => (
            <button key={r.label} type="button" className={`btn btn--xs btn--seg${range === r.points ? " btn--active" : ""}`} onClick={() => setRange(r.points)}>
              {r.label}
            </button>
          ))}
        </div>
        <span className="muted num" title="un punto por hora simulada">
          {view.length} puntos · 1/h
        </span>
      </div>

      {metrics.length === 0 && <Empty>Todavía no hay métricas: se registran una vez por hora simulada.</Empty>}

      <LineChart title="Población" x={x} series={populationSeries} integer format={fmtInt} ticksPerDay={tpd} themeKey={themeKey} />
      <LineChart title="Nacimientos y muertes" subtitle="acumulado del día" x={x} series={birthsSeries} integer format={fmtInt} ticksPerDay={tpd} themeKey={themeKey} />
      <LineChart title="Necesidades medias" subtitle="1 = satisfecha" x={x} series={needsSeries} yRange={unit} format={fmt1} ticksPerDay={tpd} themeKey={themeKey} height={190} />
      <LineChart title="Desigualdad (Gini)" x={x} series={giniSeries} yRange={unit} format={fmt2} ticksPerDay={tpd} themeKey={themeKey} height={130} />
      <LineChart title="USD gastado" subtitle="acumulado del día" x={x} series={usdSeries} format={fmtMoney} ticksPerDay={tpd} themeKey={themeKey} height={130} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="stat__label">{label}</div>
      <div className="stat__value">{value}</div>
    </div>
  );
}
