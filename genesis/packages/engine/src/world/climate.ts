import type { Weather } from "@genesis/protocol";
import type { GenesisConfig } from "../config.ts";
import type { Rng } from "../rng.ts";
import type { Clock } from "../sim/clock.ts";

export interface ClimateState {
  /** temperatura base del mundo en este tick (sin altura) */
  temperature: number;
  weather: Weather;
  drought: boolean;
  droughtUntilDay: number;
  weatherUntilTick: number;
  /** clima forzado por dios */
  forcedWeather: { weather: Weather; untilDay: number } | null;
  stormStartedTick: number;
}

export function initialClimate(): ClimateState {
  return {
    temperature: 16,
    weather: "despejado",
    drought: false,
    droughtUntilDay: -1,
    weatherUntilTick: 0,
    forcedWeather: null,
    stormStartedTick: -1,
  };
}

export type ClimateEvent =
  | { kind: "storm_start" }
  | { kind: "storm_end" }
  | { kind: "drought_start"; days: number }
  | { kind: "drought_end" }
  | { kind: "weather"; weather: Weather };

/** Temperatura ambiente "de referencia" para el tick actual. */
export function baseTemperature(clock: Clock, cfg: GenesisConfig, weather: Weather): number {
  const c = cfg.climate;
  const seasonal = Math.cos(2 * Math.PI * (clock.yearPhase - 0.33)); // pico a comienzos del verano, mínimo a fines del invierno
  const daily = Math.cos((2 * Math.PI * (clock.hour - 15)) / 24); // pico a las 15 h
  let t = c.baseTemperature + c.seasonalAmplitude * seasonal + c.dayNightAmplitude * daily;
  switch (weather) {
    case "nublado":
      t -= 1.5;
      break;
    case "lluvia":
      t -= 3;
      break;
    case "tormenta":
      t -= 5;
      break;
    case "nieve":
      t -= 6;
      break;
    case "sequia":
      t += 3;
      break;
    default:
      break;
  }
  return t;
}

/** Temperatura en una celda según su altura. */
export function cellTemperature(base: number, elevation255: number, cfg: GenesisConfig): number {
  const e = elevation255 / 255;
  const above = Math.max(0, e - cfg.world.seaLevel) / (1 - cfg.world.seaLevel);
  return base - cfg.climate.elevationCooling * above * above;
}

export function stepClimate(state: ClimateState, clock: Clock, cfg: GenesisConfig, rng: Rng): ClimateEvent[] {
  const events: ClimateEvent[] = [];
  const c = cfg.climate;
  // sequías: se deciden al empezar cada estación
  if (clock.isNewDay && clock.dayOfSeason === 0) {
    if (state.drought && clock.day >= state.droughtUntilDay) {
      state.drought = false;
      events.push({ kind: "drought_end" });
    }
    if (!state.drought && clock.season !== "invierno" && rng.chance(c.droughtChancePerSeason)) {
      const days = 4 + rng.int(cfg.time.daysPerSeason);
      state.drought = true;
      state.droughtUntilDay = clock.day + days;
      events.push({ kind: "drought_start", days });
    }
  } else if (state.drought && clock.isNewDay && clock.day >= state.droughtUntilDay) {
    state.drought = false;
    events.push({ kind: "drought_end" });
  }

  // clima: se sortea al amanecer y en episodios de pocas horas
  if (state.forcedWeather && clock.day >= state.forcedWeather.untilDay) state.forcedWeather = null;
  if (clock.tick >= state.weatherUntilTick) {
    let next: Weather = "despejado";
    if (state.forcedWeather) {
      next = state.forcedWeather.weather;
    } else if (state.drought) {
      next = rng.chance(0.15) ? "nublado" : "sequia";
    } else {
      const r = rng.float();
      const rain = c.rainChancePerDay / 3; // tres episodios por día aprox.
      const storm = c.stormChancePerDay / 3;
      if (r < storm) next = "tormenta";
      else if (r < storm + rain) next = "lluvia";
      else if (r < storm + rain + 0.25) next = "nublado";
      else next = "despejado";
    }
    if ((next === "lluvia" || next === "tormenta") && state.temperature < 1) next = "nieve";
    const hours = next === "tormenta" ? 2 + rng.int(4) : 4 + rng.int(8);
    state.weatherUntilTick = clock.tick + hours * (60 / cfg.time.minutesPerTick);
    if (next !== state.weather) {
      if (next === "tormenta") {
        state.stormStartedTick = clock.tick;
        events.push({ kind: "storm_start" });
      } else if (state.weather === "tormenta") {
        events.push({ kind: "storm_end" });
      }
      events.push({ kind: "weather", weather: next });
      state.weather = next;
    }
  }
  state.temperature = baseTemperature(clock, cfg, state.weather);
  return events;
}
