import type { ClockInfo } from "@genesis/protocol";

export const DEFAULT_TICKS_PER_DAY = 144;

export function pad2(n: number): string {
  return String(Math.max(0, Math.floor(n))).padStart(2, "0");
}

/** `14:20` a partir de una hora decimal. */
export function formatHour(hour: number): string {
  const h = Math.floor(hour) % 24;
  const m = Math.floor((hour % 1) * 60);
  return `${pad2(h)}:${pad2(m)}`;
}

/** `año 1 · primavera, día 3 · 14:20` */
export function formatClock(c: ClockInfo): string {
  return `año ${c.year + 1} · ${c.season}, día ${c.dayOfSeason + 1} · ${formatHour(c.hour)}`;
}

/** Día (desde 1) y hora del día de un tick. */
export function tickToDayTime(tick: number, ticksPerDay = DEFAULT_TICKS_PER_DAY): { day: number; hour: number } {
  const day = Math.floor(tick / ticksPerDay) + 1;
  const tickOfDay = ((tick % ticksPerDay) + ticksPerDay) % ticksPerDay;
  const hour = (tickOfDay / ticksPerDay) * 24;
  return { day, hour };
}

/** `día 12 · 08:40` */
export function formatTickLong(tick: number, ticksPerDay = DEFAULT_TICKS_PER_DAY): string {
  const { day, hour } = tickToDayTime(tick, ticksPerDay);
  return `día ${day} · ${formatHour(hour)}`;
}

/** `d12 08:40` (para ejes de gráficos) */
export function formatTickShort(tick: number, ticksPerDay = DEFAULT_TICKS_PER_DAY): string {
  const { day, hour } = tickToDayTime(tick, ticksPerDay);
  return `d${day} ${formatHour(hour)}`;
}

/** `hace 3 h` / `hace 2 días` relativo al tick actual. */
export function formatTickAgo(tick: number, now: number, ticksPerDay = DEFAULT_TICKS_PER_DAY): string {
  const diff = Math.max(0, now - tick);
  const minutesPerTick = 1440 / ticksPerDay;
  const hours = (diff * minutesPerTick) / 60;
  if (hours < 1) return "hace un rato";
  if (hours < 24) return `hace ${Math.floor(hours)} h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "hace 1 día" : `hace ${days} días`;
}
