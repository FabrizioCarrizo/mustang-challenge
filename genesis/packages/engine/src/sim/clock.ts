import { SEASONS, type Season } from "@genesis/protocol";
import type { GenesisConfig } from "../config.ts";

export interface Clock {
  tick: number;
  minuteOfDay: number;
  hour: number;
  day: number;
  dayOfSeason: number;
  seasonIndex: number;
  season: Season;
  year: number;
  dayOfYear: number;
  isDay: boolean;
  /** 0 de noche, 1 a mediodía */
  daylight: number;
  /** progreso del año en [0,1) */
  yearPhase: number;
  /** verdadero en el primer tick de un día */
  isDawnTick: boolean;
  isNewDay: boolean;
}

export function computeClock(tick: number, cfg: GenesisConfig): Clock {
  const t = cfg.time;
  const tickOfDay = tick % t.ticksPerDay;
  const minuteOfDay = tickOfDay * t.minutesPerTick;
  const hour = minuteOfDay / 60;
  const day = Math.floor(tick / t.ticksPerDay);
  const daysPerYear = t.daysPerSeason * t.seasonsPerYear;
  const dayOfYear = day % daysPerYear;
  const seasonIndex = Math.floor(dayOfYear / t.daysPerSeason) % t.seasonsPerYear;
  const season = SEASONS[seasonIndex % SEASONS.length]!;
  const dayOfSeason = dayOfYear % t.daysPerSeason;
  const year = Math.floor(day / daysPerYear);
  const yearPhase = dayOfYear / daysPerYear;
  // duración del día varía con la estación: más largo en verano (índice 1)
  const seasonalShift = Math.cos(((seasonIndex - 1) / t.seasonsPerYear) * 2 * Math.PI) * 1.5;
  const dawn = t.dawnHour - seasonalShift;
  const dusk = t.duskHour + seasonalShift;
  const isDay = hour >= dawn && hour < dusk;
  let daylight = 0;
  if (isDay) {
    const p = (hour - dawn) / (dusk - dawn);
    daylight = Math.sin(p * Math.PI);
  }
  const dawnTick = Math.round((dawn * 60) / t.minutesPerTick);
  return {
    tick,
    minuteOfDay,
    hour,
    day,
    dayOfSeason,
    seasonIndex,
    season,
    year,
    dayOfYear,
    isDay,
    daylight,
    yearPhase,
    isDawnTick: tickOfDay === dawnTick,
    isNewDay: tickOfDay === 0,
  };
}

export function ageYears(bornTick: number, tick: number, cfg: GenesisConfig): number {
  const perYear = cfg.time.ticksPerDay * cfg.time.daysPerSeason * cfg.time.seasonsPerYear;
  return (tick - bornTick) / perYear;
}

export function formatClock(c: Clock): string {
  const h = Math.floor(c.hour).toString().padStart(2, "0");
  const m = Math.floor((c.hour % 1) * 60)
    .toString()
    .padStart(2, "0");
  return `año ${c.year + 1}, ${c.season} día ${c.dayOfSeason + 1}, ${h}:${m}`;
}
