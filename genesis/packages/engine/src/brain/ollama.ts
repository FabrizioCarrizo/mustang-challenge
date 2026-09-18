import { z } from "zod";
import { emptyUsage, type BrainProvider, type BrainRequest, type BrainResponse } from "./provider.ts";

/** Proveedor local vía Ollama (`POST /api/chat` con `format` = JSON schema). */
export class OllamaBrain implements BrainProvider {
  readonly name = "ollama";
  constructor(
    private readonly host: string,
    readonly model: string,
  ) {}

  async call<T>(req: BrainRequest<T>): Promise<BrainResponse<T>> {
    const started = Date.now();
    const schema = z.toJSONSchema(req.schema as z.ZodType, { target: "draft-7" });
    const body = {
      model: this.model,
      stream: false,
      format: schema,
      options: { temperature: 0.8, num_predict: req.maxTokens },
      messages: [
        { role: "system", content: req.system.map((b) => b.text).join("\n\n") },
        { role: "user", content: req.user },
      ],
    };
    try {
      const res = await fetch(`${this.host.replace(/\/$/, "")}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: req.signal,
      });
      if (!res.ok) {
        return { status: "error", parsed: null, raw: null, usage: emptyUsage(), model: this.model, provider: this.name, latencyMs: Date.now() - started, usd: 0, error: `ollama ${res.status}: ${await res.text()}` };
      }
      const json = (await res.json()) as { message?: { content?: string }; prompt_eval_count?: number; eval_count?: number };
      const raw = json.message?.content ?? "";
      let obj: unknown = null;
      try {
        obj = JSON.parse(raw);
      } catch {
        obj = null;
      }
      const parsed = obj === null ? null : (req.schema as z.ZodType<T>).safeParse(obj);
      const usage = { inputTokens: json.prompt_eval_count ?? 0, cacheRead: 0, cacheWrite: 0, outputTokens: json.eval_count ?? 0 };
      if (!parsed || !parsed.success) {
        return { status: "invalid", parsed: null, raw, usage, model: this.model, provider: this.name, latencyMs: Date.now() - started, usd: 0, error: parsed ? parsed.error.message : "JSON inválido" };
      }
      return { status: "ok", parsed: parsed.data, raw, usage, model: this.model, provider: this.name, latencyMs: Date.now() - started, usd: 0, error: null };
    } catch (err) {
      if (req.signal?.aborted) {
        return { status: "aborted", parsed: null, raw: null, usage: emptyUsage(), model: this.model, provider: this.name, latencyMs: Date.now() - started, usd: 0, error: "abortado" };
      }
      return { status: "error", parsed: null, raw: null, usage: emptyUsage(), model: this.model, provider: this.name, latencyMs: Date.now() - started, usd: 0, error: `ollama: ${(err as Error).message}` };
    }
  }
}
