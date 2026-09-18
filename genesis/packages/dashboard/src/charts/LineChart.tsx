import { useEffect, useMemo, useRef } from "react";
import uPlot from "uplot";
import { formatTickLong, formatTickShort } from "../lib/time.ts";
import { type ChartTheme, readChartTheme } from "./theme.ts";

export interface SeriesDef {
  label: string;
  values: Array<number | null>;
  /** índice en la paleta categórica (0..7), fijo por serie */
  slot: number;
}

export interface LineChartProps {
  title: string;
  subtitle?: string;
  x: number[];
  series: SeriesDef[];
  /** rango fijo del eje y; si falta, se ajusta desde 0 al máximo */
  yRange?: [number, number];
  /** valores enteros: divisiones del eje y solo en enteros */
  integer?: boolean;
  format?: (v: number) => string;
  height?: number;
  ticksPerDay: number;
  themeKey: string;
}

const defaultFormat = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

/** Tooltip + línea guía compartidos por todos los gráficos. */
function tooltipPlugin(theme: ChartTheme, labels: string[], colors: string[], fmt: (v: number) => string, tpd: number): uPlot.Plugin {
  let el: HTMLDivElement | null = null;
  return {
    hooks: {
      init: (u) => {
        el = document.createElement("div");
        el.className = "chart-tip";
        el.style.display = "none";
        u.over.appendChild(el);
        u.over.addEventListener("mouseleave", () => {
          if (el) el.style.display = "none";
        });
      },
      setCursor: (u) => {
        if (!el) return;
        const idx = u.cursor.idx;
        if (idx === null || idx === undefined) {
          el.style.display = "none";
          return;
        }
        const xv = u.data[0][idx];
        if (xv === undefined) return;
        const rows = labels
          .map((label, i) => {
            const v = u.data[i + 1]?.[idx];
            if (v === null || v === undefined) return "";
            return `<div class="chart-tip__row"><span class="chart-tip__swatch" style="background:${colors[i]}"></span><span>${label}</span><span class="chart-tip__val">${fmt(v)}</span></div>`;
          })
          .join("");
        el.innerHTML = `<div class="chart-tip__time">${formatTickLong(xv, tpd)}</div>${rows}`;
        el.style.display = "block";
        const left = u.cursor.left ?? 0;
        const top = u.cursor.top ?? 0;
        const w = u.over.clientWidth;
        const tipW = el.offsetWidth;
        const flip = left + tipW + 16 > w;
        el.style.left = `${flip ? left - tipW - 10 : left + 10}px`;
        el.style.top = `${Math.max(0, Math.min(top - 8, u.over.clientHeight - el.offsetHeight))}px`;
        void theme;
      },
    },
  };
}

const INTEGER_INCRS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];

export function LineChart({ title, subtitle, x, series, yRange, integer = false, format = defaultFormat, height = 150, ticksPerDay, themeKey }: LineChartProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const seriesKey = series.map((s) => `${s.label}:${s.slot}`).join("|");
  const data = useMemo<uPlot.AlignedData>(() => [x, ...series.map((s) => s.values)] as uPlot.AlignedData, [x, series]);
  const dataRef = useRef(data);
  dataRef.current = data;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const theme = readChartTheme(themeKey);
    const defs = seriesKey.split("|").map((k) => {
      const i = k.lastIndexOf(":");
      return { label: k.slice(0, i), slot: Number(k.slice(i + 1)) };
    });
    const colors = defs.map((d) => theme.series[d.slot % theme.series.length]!);
    const labels = defs.map((d) => d.label);
    const width = Math.max(120, host.clientWidth);
    const opts: uPlot.Options = {
      width,
      height,
      padding: [10, 12, 0, 2],
      cursor: {
        x: true,
        y: false,
        points: { size: 8, width: 2, fill: theme.surface },
        drag: { x: false, y: false, setScale: false },
      },
      legend: {
        show: defs.length > 1,
        live: false,
        // uPlot envuelve `series.stroke` en una función: usamos nuestra lista de colores
        markers: { width: 0, fill: (_u, i) => colors[i - 1] ?? "currentColor" },
      },
      scales: {
        x: { time: false },
        y: yRange ? { range: yRange } : { range: (_u, _min, max) => [0, integer ? Math.max(4, Math.ceil(max * 1.15)) : Math.max(1, max * 1.12)] },
      },
      axes: [
        {
          stroke: theme.muted,
          font: theme.font,
          gap: 6,
          space: 72,
          grid: { show: true, stroke: theme.grid, width: 1 },
          ticks: { show: true, stroke: theme.grid, width: 1, size: 4 },
          values: (_u, splits) => splits.map((v) => formatTickShort(v, ticksPerDay)),
        },
        {
          stroke: theme.muted,
          font: theme.font,
          gap: 6,
          size: 48,
          grid: { show: true, stroke: theme.grid, width: 1 },
          ticks: { show: false },
          ...(integer ? { incrs: INTEGER_INCRS } : {}),
          values: (_u, splits) => splits.map((v) => format(v)),
        },
      ],
      series: [
        {},
        ...defs.map((d, i) => ({
          label: d.label,
          stroke: colors[i],
          width: 2,
          points: { show: false },
          spanGaps: true,
        })),
      ],
      plugins: [tooltipPlugin(theme, labels, colors, format, ticksPerDay)],
    };
    const u = new uPlot(opts, dataRef.current, host);
    plotRef.current = u;
    const ro = new ResizeObserver(() => {
      const w = Math.max(120, host.clientWidth);
      if (w !== u.width) u.setSize({ width: w, height });
    });
    ro.observe(host);
    return () => {
      ro.disconnect();
      u.destroy();
      plotRef.current = null;
    };
  }, [themeKey, seriesKey, height, ticksPerDay, yRange?.[0], yRange?.[1], format, integer]);

  useEffect(() => {
    plotRef.current?.setData(data);
  }, [data]);

  const last = x.length - 1;
  return (
    <figure className="chart-card">
      <figcaption className="chart-card__head">
        <span className="chart-card__title">{title}</span>
        {subtitle && <span className="chart-card__sub muted">{subtitle}</span>}
        {last >= 0 && series.length === 1 && series[0]!.values[last] !== null && series[0]!.values[last] !== undefined && (
          <span className="chart-card__last num" title="último valor">
            {format(series[0]!.values[last] as number)}
          </span>
        )}
      </figcaption>
      <div className="chart" ref={hostRef} />
      {x.length === 0 && <div className="empty empty--inline">sin datos todavía</div>}
      {x.length > 0 && (
        <details className="chart-table">
          <summary>ver tabla</summary>
          <table>
            <thead>
              <tr>
                <th>momento</th>
                {series.map((s) => (
                  <th key={s.label}>{s.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {x
                .slice(-12)
                .map((tick, i) => {
                  const idx = x.length - Math.min(12, x.length) + i;
                  return (
                    <tr key={tick}>
                      <td className="num">{formatTickLong(tick, ticksPerDay)}</td>
                      {series.map((s) => (
                        <td key={s.label} className="num">
                          {s.values[idx] === null || s.values[idx] === undefined ? "—" : format(s.values[idx] as number)}
                        </td>
                      ))}
                    </tr>
                  );
                })
                .reverse()}
            </tbody>
          </table>
        </details>
      )}
    </figure>
  );
}
