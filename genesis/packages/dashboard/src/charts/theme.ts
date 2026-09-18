import { useEffect, useState } from "react";
import { cssVar } from "../lib/colors.ts";

export interface ChartTheme {
  key: string;
  surface: string;
  grid: string;
  muted: string;
  text: string;
  series: string[];
  font: string;
}

function currentKey(): string {
  const attr = document.documentElement.getAttribute("data-theme") ?? "auto";
  const light = window.matchMedia("(prefers-color-scheme: light)").matches;
  return `${attr}:${light ? "light" : "dark"}`;
}

/** Cambia cuando cambia el tema (sistema o selector), para reconstruir los gráficos. */
export function useThemeKey(): string {
  const [key, setKey] = useState(currentKey);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const update = () => setKey(currentKey());
    mq.addEventListener("change", update);
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      mq.removeEventListener("change", update);
      mo.disconnect();
    };
  }, []);
  return key;
}

export function readChartTheme(key: string): ChartTheme {
  return {
    key,
    surface: cssVar("--chart-surface", "#1a1a19"),
    grid: cssVar("--chart-grid", "#2c2c2a"),
    muted: cssVar("--chart-muted", "#898781"),
    text: cssVar("--chart-text", "#ffffff"),
    series: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => cssVar(`--series-${i}`, "#3987e5")),
    font: `11px ${cssVar("--font", "system-ui, sans-serif")}`,
  };
}
