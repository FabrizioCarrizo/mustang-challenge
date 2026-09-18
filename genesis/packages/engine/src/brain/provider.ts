import type { z } from "zod";
import type { CallType } from "../cognition/system2/schemas.ts";

export interface SystemBlock {
  text: string;
  /** marca este bloque como fin de prefijo cacheable */
  cache: boolean;
}

export interface BrainUsage {
  inputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  outputTokens: number;
}

export type BrainStatus = "ok" | "invalid" | "refusal" | "error" | "aborted" | "stale" | "budget";

export interface BrainRequest<T> {
  id: number;
  agentId: number | null;
  type: CallType;
  route: "routine" | "epochal";
  system: SystemBlock[];
  user: string;
  schema: z.ZodType<T>;
  maxTokens: number;
  signal?: AbortSignal;
  /** hash del prefijo estable (para diagnóstico de caché) */
  promptHash: string;
  /** contexto estructurado para proveedores que lo usen (MockBrain) y para el log */
  meta?: Record<string, unknown>;
}

export interface BrainResponse<T> {
  status: BrainStatus;
  parsed: T | null;
  raw: string | null;
  usage: BrainUsage;
  model: string;
  provider: string;
  latencyMs: number;
  usd: number;
  error: string | null;
}

export interface BrainProvider {
  readonly name: string;
  readonly model: string;
  call<T>(req: BrainRequest<T>): Promise<BrainResponse<T>>;
  /** cuenta tokens de un texto (si el proveedor lo permite) */
  countTokens?(system: SystemBlock[], user: string): Promise<number>;
}

export interface ModelPrice {
  /** USD por millón de tokens */
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** Precios de la API de Anthropic (USD por MTok). */
export const MODEL_PRICES: Record<string, ModelPrice> = {
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-7": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-6": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
  "claude-fable-5": { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
};

export function priceFor(model: string): ModelPrice {
  const exact = MODEL_PRICES[model];
  if (exact) return exact;
  for (const [k, v] of Object.entries(MODEL_PRICES)) if (model.startsWith(k)) return v;
  if (model.includes("haiku")) return MODEL_PRICES["claude-haiku-4-5"]!;
  if (model.includes("sonnet")) return MODEL_PRICES["claude-sonnet-5"]!;
  if (model.includes("opus")) return MODEL_PRICES["claude-opus-5"]!;
  if (model.includes("fable") || model.includes("mythos")) return MODEL_PRICES["claude-fable-5-1"]!;
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

export function usdFor(model: string, u: BrainUsage): number {
  const p = priceFor(model);
  return (u.inputTokens * p.input + u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite + u.outputTokens * p.output) / 1_000_000;
}

export function emptyUsage(): BrainUsage {
  return { inputTokens: 0, cacheRead: 0, cacheWrite: 0, outputTokens: 0 };
}

/** Estimación grosera de tokens para presupuestar antes de llamar (≈ 1 token cada 3.6 caracteres en español). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.6);
}
