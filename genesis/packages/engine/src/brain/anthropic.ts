import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import type { BrainRoute } from "../config.ts";
import { emptyUsage, usdFor, type BrainProvider, type BrainRequest, type BrainResponse, type BrainUsage, type SystemBlock } from "./provider.ts";

/**
 * Proveedor Claude. Bloques de sistema con cache_control (leyes → guía →
 * ficha), salida estructurada con zod, y en la ruta épica el fallback de
 * servidor para rechazos.
 */
export class AnthropicBrain implements BrainProvider {
  readonly name = "anthropic";
  readonly model: string;
  private readonly client: Anthropic;
  private readonly effort: BrainRoute["effort"];

  constructor(route: BrainRoute, client?: Anthropic) {
    this.model = route.model;
    this.effort = route.effort;
    this.client = client ?? new Anthropic({ maxRetries: 2 });
  }

  private get isFable(): boolean {
    return this.model.includes("fable") || this.model.includes("mythos");
  }

  private get supportsEffort(): boolean {
    return !this.model.includes("haiku") && !this.model.includes("sonnet-4-5") && !this.model.includes("4-5");
  }

  private systemParam(blocks: SystemBlock[]): Anthropic.TextBlockParam[] {
    return blocks.map((b) => (b.cache ? { type: "text", text: b.text, cache_control: { type: "ephemeral" } } : { type: "text", text: b.text }));
  }

  async countTokens(system: SystemBlock[], user: string): Promise<number> {
    const r = await this.client.messages.countTokens({
      model: this.model,
      system: this.systemParam(system),
      messages: [{ role: "user", content: user }],
    });
    return r.input_tokens;
  }

  async call<T>(req: BrainRequest<T>): Promise<BrainResponse<T>> {
    const started = Date.now();
    const base = {
      model: this.model,
      max_tokens: req.maxTokens,
      system: this.systemParam(req.system),
      messages: [{ role: "user" as const, content: req.user }],
    };
    const outputConfig: Record<string, unknown> = { format: zodOutputFormat(req.schema as z.ZodType<T>) };
    if (this.effort && this.supportsEffort) outputConfig.effort = this.effort;
    try {
      let raw: string | null = null;
      let parsed: T | null = null;
      let usage: BrainUsage = emptyUsage();
      let stopReason: string | null = null;
      let servedModel = this.model;
      if (this.isFable) {
        const res = await this.client.beta.messages.create(
          {
            ...base,
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            output_config: outputConfig,
          } as never,
          { signal: req.signal },
        );
        const msg = res as unknown as Anthropic.Beta.BetaMessage;
        stopReason = msg.stop_reason;
        servedModel = msg.model ?? this.model;
        usage = toUsage(msg.usage as unknown as UsageLike);
        raw = textOf(msg.content as unknown as Array<{ type: string; text?: string }>);
        if (raw && stopReason !== "refusal") {
          const p = (req.schema as z.ZodType<T>).safeParse(safeJson(raw));
          parsed = p.success ? p.data : null;
        }
      } else {
        const res = await this.client.messages.parse(
          {
            ...base,
            output_config: outputConfig as never,
          },
          { signal: req.signal },
        );
        stopReason = res.stop_reason;
        servedModel = res.model ?? this.model;
        usage = toUsage(res.usage as unknown as UsageLike);
        raw = textOf(res.content as unknown as Array<{ type: string; text?: string }>);
        parsed = (res.parsed_output as T | null) ?? null;
        if (parsed === null && raw && stopReason !== "refusal") {
          const p = (req.schema as z.ZodType<T>).safeParse(safeJson(raw));
          parsed = p.success ? p.data : null;
        }
      }
      const usd = usdFor(servedModel, usage);
      if (stopReason === "refusal") {
        return { status: "refusal", parsed: null, raw, usage, model: servedModel, provider: this.name, latencyMs: Date.now() - started, usd, error: "rechazo del modelo" };
      }
      if (parsed === null) {
        return { status: "invalid", parsed: null, raw, usage, model: servedModel, provider: this.name, latencyMs: Date.now() - started, usd, error: stopReason === "max_tokens" ? "salida truncada" : "JSON inválido" };
      }
      return { status: "ok", parsed, raw, usage, model: servedModel, provider: this.name, latencyMs: Date.now() - started, usd, error: null };
    } catch (err) {
      if (req.signal?.aborted) {
        return { status: "aborted", parsed: null, raw: null, usage: emptyUsage(), model: this.model, provider: this.name, latencyMs: Date.now() - started, usd: 0, error: "abortado" };
      }
      const message = describeError(err);
      return { status: "error", parsed: null, raw: null, usage: emptyUsage(), model: this.model, provider: this.name, latencyMs: Date.now() - started, usd: 0, error: message };
    }
  }
}

interface UsageLike {
  input_tokens?: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  output_tokens?: number;
}

function toUsage(u: UsageLike | undefined): BrainUsage {
  return {
    inputTokens: u?.input_tokens ?? 0,
    cacheRead: u?.cache_read_input_tokens ?? 0,
    cacheWrite: u?.cache_creation_input_tokens ?? 0,
    outputTokens: u?.output_tokens ?? 0,
  };
}

function textOf(content: Array<{ type: string; text?: string }>): string | null {
  const parts = content.filter((b) => b.type === "text" && typeof b.text === "string").map((b) => b.text as string);
  return parts.length ? parts.join("") : null;
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export function describeError(err: unknown): string {
  if (err instanceof Anthropic.RateLimitError) return `rate limit (429): ${err.message}`;
  if (err instanceof Anthropic.AuthenticationError) return "credenciales inválidas (definí ANTHROPIC_API_KEY o usá `ant auth login`)";
  if (err instanceof Anthropic.BadRequestError) return `pedido inválido (400): ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return `sin conexión con la API: ${err.message}`;
  if (err instanceof Anthropic.APIError) return `error de API ${err.status}: ${err.message}`;
  return (err as Error)?.message ?? String(err);
}

export function isRateLimit(message: string | null): boolean {
  return !!message && message.startsWith("rate limit");
}
