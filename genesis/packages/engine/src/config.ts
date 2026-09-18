import { z } from "zod";

/**
 * EL BLOQUE GÉNESIS: las leyes del mundo. Todo parámetro que cambia la física
 * vive acá y queda guardado dentro del mundo cuando se crea.
 */

const num = z.number();
const int = z.number().int();

export const BrainRouteSchema = z.object({
  provider: z.enum(["anthropic", "ollama", "mock", "none"]),
  model: z.string(),
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]).nullable(),
  maxTokens: int.min(64),
});

export const GenesisConfigSchema = z.object({
  world: z.object({
    name: z.string(),
    size: int.min(32).max(256),
    initialPopulation: int.min(2).max(600),
    /** 0.5 = mundo pobre, 1 = normal, 2 = abundante */
    abundance: num.min(0.1).max(5),
    seaLevel: num.min(0).max(1),
    mountainLevel: num.min(0).max(1),
    forestMoisture: num.min(0).max(1),
  }),
  time: z.object({
    minutesPerTick: int.min(1),
    ticksPerDay: int.min(24),
    daysPerSeason: int.min(1),
    seasonsPerYear: int.min(1),
    /** hora del amanecer en horas */
    dawnHour: num,
    duskHour: num,
  }),
  life: z.object({
    adultAgeYears: num,
    fertileFromYears: num,
    fertileToYears: num,
    elderAgeYears: num,
    maxAgeYears: num,
    gestationDays: num,
    childhoodMinAgeYearsForPlans: num,
    baseFertilityPerDay: num,
    diseaseChancePerDay: num,
  }),
  needs: z.object({
    /** decaimiento por tick de la satisfacción (0..1) */
    decay: z.object({
      sed: num,
      hambre: num,
      calor: num,
      descanso: num,
      seguridad: num,
      social: num,
      estima: num,
      sentido: num,
    }),
    /** pesos de urgencia por necesidad */
    weights: z.object({
      sed: num,
      hambre: num,
      calor: num,
      descanso: num,
      seguridad: num,
      social: num,
      estima: num,
      sentido: num,
    }),
    /** daño a la salud por hora cuando la necesidad está en cero */
    damagePerHour: z.object({ sed: num, hambre: num, calor: num }),
    /** recuperación de salud por hora con las necesidades cubiertas */
    healPerHour: num,
    sleepRecoveryPerTick: num,
    foodPerUnit: num,
    drinkPerTick: num,
  }),
  resources: z.object({
    /** máximo por celda (antes del factor de fertilidad) */
    maxPerCell: z.object({ comida: num, madera: num, piedra: num, mineral: num, gema: num }),
    /** tasa logística de regeneración por hora */
    regrowthPerHour: z.object({ comida: num, madera: num, piedra: num, mineral: num, gema: num }),
    /** multiplicador de regeneración por estación */
    seasonFactor: z.object({ primavera: num, verano: num, otoño: num, invierno: num }),
    gatherPerTick: num,
    reseedChancePerHour: num,
  }),
  climate: z.object({
    baseTemperature: num,
    seasonalAmplitude: num,
    dayNightAmplitude: num,
    elevationCooling: num,
    rainChancePerDay: num,
    stormChancePerDay: num,
    droughtChancePerSeason: num,
    droughtRegrowthFactor: num,
    comfortTemperature: num,
    shelterWarmth: num,
    fireWarmth: num,
    clothingWarmth: num,
  }),
  social: z.object({
    perceptionRadius: int.min(1),
    smallTalkSocialGain: num,
    dialogueScoreThreshold: num,
    maxDialoguesPerAgentPerDay: int,
    maxNewDialoguesPerTickDivisor: int,
    trustDecayPerDay: num,
  }),
  brain: z.object({
    mode: z.enum(["none", "mock", "claude", "ollama", "hybrid"]),
    language: z.enum(["es", "en"]),
    dialogueMode: z.enum(["director", "turns"]),
    routine: BrainRouteSchema,
    epochal: BrainRouteSchema,
    ollama: z.object({ host: z.string(), model: z.string() }),
    concurrency: int.min(1).max(32),
    retrievalK: int.min(1).max(40),
    caloriesPerCall: num,
    maxCallsPerAgentPerDay: int,
    maxTokensPerAgentPerDay: int,
    reflectionImportanceThreshold: num,
    historianEveryDays: int,
    mockLatencyMs: int,
  }),
  budget: z.object({
    usdPerSimDay: num,
    usdPerRealHour: num,
    usdTotal: num,
  }),
  pacing: z.object({
    preset: z.enum(["contemplativo", "cronica", "local", "mock", "auto"]),
    simDayRealSeconds: num.min(1),
    multiplier: num.min(0).max(1000),
    /** cuántos ticks puede atrasarse el mundo respecto de las mentes antes de frenar */
    maxPendingPlans: int,
  }),
  persistence: z.object({
    snapshotEveryTicks: int.min(1),
    retentionDays: int,
    memoryFoldDays: int,
    memoryFoldImportance: num,
  }),
});

export type GenesisConfig = z.infer<typeof GenesisConfigSchema>;
export type BrainRoute = z.infer<typeof BrainRouteSchema>;

export const DEFAULT_CONFIG: GenesisConfig = {
  world: {
    name: "eden",
    size: 128,
    initialPopulation: 40,
    abundance: 1,
    seaLevel: 0.36,
    mountainLevel: 0.8,
    forestMoisture: 0.55,
  },
  time: {
    minutesPerTick: 10,
    ticksPerDay: 144,
    daysPerSeason: 8,
    seasonsPerYear: 4,
    dawnHour: 6,
    duskHour: 20,
  },
  life: {
    adultAgeYears: 1.5,
    fertileFromYears: 1.5,
    fertileToYears: 6,
    elderAgeYears: 8,
    maxAgeYears: 11,
    gestationDays: 6,
    childhoodMinAgeYearsForPlans: 0.5,
    baseFertilityPerDay: 0.08,
    diseaseChancePerDay: 0.004,
  },
  needs: {
    decay: {
      sed: 0.0035,
      hambre: 0.0023,
      calor: 0.01,
      descanso: 0.0104,
      seguridad: 0,
      social: 0.0023,
      estima: 0.001,
      sentido: 0.0005,
    },
    weights: {
      sed: 1.6,
      hambre: 1.5,
      calor: 1.3,
      descanso: 1.0,
      seguridad: 1.4,
      social: 0.6,
      estima: 0.4,
      sentido: 0.5,
    },
    damagePerHour: { sed: 0.02, hambre: 0.01, calor: 0.015 },
    healPerHour: 0.01,
    sleepRecoveryPerTick: 0.0208,
    foodPerUnit: 0.35,
    drinkPerTick: 0.5,
  },
  resources: {
    maxPerCell: { comida: 6, madera: 10, piedra: 12, mineral: 6, gema: 2 },
    regrowthPerHour: { comida: 0.02, madera: 0.004, piedra: 0.0005, mineral: 0.0002, gema: 0.0001 },
    seasonFactor: { primavera: 1.4, verano: 1.0, otoño: 0.6, invierno: 0.1 },
    gatherPerTick: 1,
    reseedChancePerHour: 0.01,
  },
  climate: {
    baseTemperature: 16,
    seasonalAmplitude: 13,
    dayNightAmplitude: 7,
    elevationCooling: 12,
    rainChancePerDay: 0.25,
    stormChancePerDay: 0.03,
    droughtChancePerSeason: 0.12,
    droughtRegrowthFactor: 0.3,
    comfortTemperature: 18,
    shelterWarmth: 10,
    fireWarmth: 12,
    clothingWarmth: 6,
  },
  social: {
    perceptionRadius: 6,
    smallTalkSocialGain: 0.15,
    dialogueScoreThreshold: 0.6,
    maxDialoguesPerAgentPerDay: 3,
    maxNewDialoguesPerTickDivisor: 20,
    trustDecayPerDay: 0.002,
  },
  brain: {
    mode: "mock",
    language: "es",
    dialogueMode: "director",
    routine: { provider: "anthropic", model: "claude-haiku-4-5", effort: null, maxTokens: 1200 },
    epochal: { provider: "anthropic", model: "claude-fable-5-1", effort: "medium", maxTokens: 3000 },
    ollama: { host: "http://127.0.0.1:11434", model: "qwen3:14b" },
    concurrency: 8,
    retrievalK: 15,
    caloriesPerCall: 0.02,
    maxCallsPerAgentPerDay: 8,
    maxTokensPerAgentPerDay: 20000,
    reflectionImportanceThreshold: 150,
    historianEveryDays: 7,
    mockLatencyMs: 0,
  },
  budget: {
    usdPerSimDay: 2,
    usdPerRealHour: 1,
    usdTotal: 50,
  },
  pacing: {
    preset: "cronica",
    simDayRealSeconds: 600,
    multiplier: 1,
    maxPendingPlans: 40,
  },
  persistence: {
    snapshotEveryTicks: 144,
    retentionDays: 90,
    memoryFoldDays: 14,
    memoryFoldImportance: 4,
  },
};

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
export type GenesisConfigInput = DeepPartial<GenesisConfig>;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(patch) || !isPlainObject(base)) return (patch === undefined ? base : patch) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const cur = (base as Record<string, unknown>)[k];
    out[k] = isPlainObject(cur) && isPlainObject(v) ? deepMerge(cur, v) : v;
  }
  return out as T;
}

/** Valida y completa una configuración parcial con los valores por defecto. */
export function loadConfig(input: GenesisConfigInput = {}): GenesisConfig {
  return GenesisConfigSchema.parse(deepMerge(DEFAULT_CONFIG, input));
}

/** Ticks por año simulado. */
export function ticksPerYear(cfg: GenesisConfig): number {
  return cfg.time.ticksPerDay * cfg.time.daysPerSeason * cfg.time.seasonsPerYear;
}

export function ticksPerHour(cfg: GenesisConfig): number {
  return 60 / cfg.time.minutesPerTick;
}

/** Presets de ritmo y densidad cognitiva. */
export const PACING_PRESETS: Record<string, { simDayRealSeconds: number; callDensity: number; description: string }> = {
  contemplativo: {
    simDayRealSeconds: 3600,
    callDensity: 1,
    description: "≈1 h real por día simulado, cognición rica (≈3 llamadas por ser y día)",
  },
  cronica: {
    simDayRealSeconds: 600,
    callDensity: 0.25,
    description: "10 min reales por día simulado, cognición espaciada (≈0.5 llamadas por ser y día)",
  },
  local: {
    simDayRealSeconds: 600,
    callDensity: 1,
    description: "Ollama para lo rutinario, Claude solo para lo épico",
  },
  mock: {
    simDayRealSeconds: 1,
    callDensity: 1,
    description: "sin LLM, velocidad máxima",
  },
  auto: {
    simDayRealSeconds: 600,
    callDensity: 1,
    description: "segundos por día derivados del presupuesto por hora real",
  },
};
