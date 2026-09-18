export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function fmtUsd(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return "—";
  if (v >= 1000) return `$${v.toLocaleString("es-AR", { maximumFractionDigits: 0 })}`;
  return `$${v.toFixed(digits)}`;
}

export function fmtNum(v: number, digits = 0): string {
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString("es-AR", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function fmtPct(v: number, digits = 0): string {
  if (!Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

export function fmtCompact(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${(v / 1000).toFixed(0)}K`;
  if (abs >= 1000) return `${(v / 1000).toFixed(1)}K`;
  return String(Math.round(v));
}

export function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function capitalize(s: string): string {
  return s.length ? s[0]!.toUpperCase() + s.slice(1) : s;
}
