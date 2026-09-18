import type { BudgetInfo } from "@genesis/protocol";
import type { BrainRoutes } from "../brain/router.ts";
import type { BrainRequest, BrainResponse } from "../brain/provider.ts";
import { usdFor } from "../brain/provider.ts";
import type { GenesisConfig } from "../config.ts";
import type { CallType } from "./system2/schemas.ts";

export interface ThoughtRequest {
  id: number;
  agentId: number | null;
  type: CallType;
  route: "routine" | "epochal";
  /** 0 es la más alta */
  priority: number;
  enqueuedTick: number;
  deadlineTick: number | null;
  estUsd: number;
  /** clave de deduplicación */
  key: string;
  /** arma el pedido en el momento de despachar; null cancela */
  build: () => BrainRequest<unknown> | null;
  apply: (res: BrainResponse<unknown>, stale: boolean) => void;
  onDropped?: (reason: string) => void;
}

export interface Completed {
  req: ThoughtRequest;
  res: BrainResponse<unknown>;
  dispatchedTick: number;
}

/** Contabilidad de gasto con tres topes: por día simulado, por hora real y total. */
export class BudgetTracker {
  usdToday = 0;
  usdTotal = 0;
  private hourWindow: Array<[number, number]> = [];
  muted: "none" | "day" | "hour" | "total" = "none";
  /** modo forzado (replay): reproduce el silencio grabado en vez de calcularlo del gasto */
  override: "none" | "day" | "hour" | "total" | null = null;

  constructor(
    public usdPerSimDay: number,
    public usdPerRealHour: number,
    public usdTotalCap: number,
  ) {}

  add(usd: number, now = Date.now()): void {
    this.usdToday += usd;
    this.usdTotal += usd;
    this.hourWindow.push([now, usd]);
  }

  usdLastHour(now = Date.now()): number {
    const cutoff = now - 3_600_000;
    while (this.hourWindow.length && this.hourWindow[0]![0] < cutoff) this.hourWindow.shift();
    let s = 0;
    for (const [, u] of this.hourWindow) s += u;
    return s;
  }

  newDay(): void {
    this.usdToday = 0;
    if (this.override !== null) return;
    if (this.muted === "day") this.muted = "none";
  }

  /** ¿Se puede gastar `estUsd` más? Actualiza el modo mudo. */
  allows(estUsd: number, now = Date.now()): boolean {
    if (this.override !== null) {
      this.muted = this.override;
      return this.override === "none";
    }
    if (this.usdTotalCap > 0 && this.usdTotal + estUsd > this.usdTotalCap) {
      this.muted = "total";
      return false;
    }
    if (this.usdPerSimDay > 0 && this.usdToday + estUsd > this.usdPerSimDay) {
      this.muted = "day";
      return false;
    }
    if (this.usdPerRealHour > 0 && this.usdLastHour(now) + estUsd > this.usdPerRealHour) {
      this.muted = "hour";
      return false;
    }
    if (this.muted === "hour" || this.muted === "day") this.muted = "none";
    return true;
  }
}

/**
 * Cola de pensamientos: prioridad, equidad por gasto, presupuesto, concurrencia
 * y escalera de degradación. Nunca bloquea el loop del mundo.
 */
export class ThoughtScheduler {
  private queue: ThoughtRequest[] = [];
  private inFlight = new Map<number, { req: ThoughtRequest; controller: AbortController; tick: number }>();
  private completed: Completed[] = [];
  readonly budget: BudgetTracker;
  concurrency: number;
  /** densidad cognitiva del preset (0..1) */
  density = 1;
  private agentSpend = new Map<number, number>();
  private consecutiveErrors = 0;
  private rateLimitedUntil = 0;
  cacheReadTokens = 0;
  inputTokens = 0;
  callsOk = 0;
  callsFailed = 0;
  lastError: string | null = null;
  /** llamadas que fueron descartadas por presupuesto o presión */
  dropped = 0;

  constructor(
    public routes: BrainRoutes,
    cfg: GenesisConfig,
    private readonly tickNow: () => number,
  ) {
    this.budget = new BudgetTracker(cfg.budget.usdPerSimDay, cfg.budget.usdPerRealHour, cfg.budget.usdTotal);
    this.concurrency = cfg.brain.concurrency;
  }

  get queued(): number {
    return this.queue.length;
  }

  get flying(): number {
    return this.inFlight.size;
  }

  get muted(): boolean {
    return this.budget.muted !== "none";
  }

  pendingOfType(type: CallType): number {
    let n = 0;
    for (const r of this.queue) if (r.type === type) n++;
    for (const { req } of this.inFlight.values()) if (req.type === type) n++;
    return n;
  }

  has(key: string): boolean {
    if (this.queue.some((r) => r.key === key)) return true;
    for (const { req } of this.inFlight.values()) if (req.key === key) return true;
    return false;
  }

  enqueue(req: ThoughtRequest): boolean {
    if (this.has(req.key)) return false;
    // escalera de degradación por presión de cola
    const depth = this.queue.length;
    if (depth > this.concurrency * 6 && req.priority >= 2) {
      this.dropped++;
      req.onDropped?.("presión de cola");
      return false;
    }
    if (depth > this.concurrency * 3 && req.priority >= 3) {
      this.dropped++;
      req.onDropped?.("presión de cola");
      return false;
    }
    this.queue.push(req);
    this.queue.sort((p, q) => this.sortKey(p) - this.sortKey(q) || p.enqueuedTick - q.enqueuedTick || p.id - q.id);
    return true;
  }

  private sortKey(r: ThoughtRequest): number {
    const spend = r.agentId !== null ? (this.agentSpend.get(r.agentId) ?? 0) : 0;
    const avg = this.agentSpend.size ? this.budget.usdTotal / this.agentSpend.size : 0;
    const fairness = avg > 0 ? Math.min(2, spend / avg) : 0;
    return r.priority + 0.5 * fairness;
  }

  /** Despacha lo que el presupuesto y la concurrencia permitan. */
  pump(now = Date.now()): void {
    if (now < this.rateLimitedUntil) return;
    while (this.inFlight.size < this.concurrency && this.queue.length > 0) {
      const req = this.queue.shift()!;
      const tick = this.tickNow();
      if (req.deadlineTick !== null && tick > req.deadlineTick) {
        this.dropped++;
        req.onDropped?.("venció antes de despacharse");
        continue;
      }
      if (!this.budget.allows(req.estUsd, now) && req.priority > 0) {
        this.dropped++;
        req.onDropped?.(`presupuesto agotado (${this.budget.muted})`);
        continue;
      }
      const brainReq = req.build();
      if (!brainReq) {
        req.onDropped?.("ya no tiene sentido");
        continue;
      }
      const controller = new AbortController();
      brainReq.signal = controller.signal;
      this.inFlight.set(req.id, { req, controller, tick });
      const provider = req.route === "epochal" ? this.routes.epochal : this.routes.routine;
      provider
        .call(brainReq)
        .then((res) => this.finish(req, res, tick))
        .catch((err: unknown) => {
          this.finish(
            req,
            {
              status: "error",
              parsed: null,
              raw: null,
              usage: { inputTokens: 0, cacheRead: 0, cacheWrite: 0, outputTokens: 0 },
              model: provider.model,
              provider: provider.name,
              latencyMs: 0,
              usd: 0,
              error: (err as Error).message,
            },
            tick,
          );
        });
    }
  }

  private finish(req: ThoughtRequest, res: BrainResponse<unknown>, dispatchedTick: number): void {
    this.inFlight.delete(req.id);
    const usd = res.usd || usdFor(res.model, res.usage);
    this.budget.add(usd);
    if (req.agentId !== null) this.agentSpend.set(req.agentId, (this.agentSpend.get(req.agentId) ?? 0) + usd);
    this.cacheReadTokens += res.usage.cacheRead;
    this.inputTokens += res.usage.inputTokens + res.usage.cacheRead + res.usage.cacheWrite;
    if (res.status === "ok") {
      this.callsOk++;
      this.consecutiveErrors = 0;
    } else if (res.status === "error") {
      this.callsFailed++;
      this.lastError = res.error;
      this.consecutiveErrors++;
      if (res.error && res.error.startsWith("rate limit")) {
        this.rateLimitedUntil = Date.now() + Math.min(60_000, 2_000 * 2 ** Math.min(5, this.consecutiveErrors));
        this.concurrency = Math.max(1, Math.floor(this.concurrency / 2));
      } else if (this.consecutiveErrors >= 5) {
        this.rateLimitedUntil = Date.now() + 30_000;
      }
    } else {
      this.callsFailed++;
      this.lastError = res.error;
    }
    this.completed.push({ req, res, dispatchedTick });
  }

  /** Devuelve los resultados listos para integrar en este tick. */
  drain(): Completed[] {
    const out = this.completed;
    this.completed = [];
    return out;
  }

  abortAll(): void {
    for (const { req, controller } of this.inFlight.values()) {
      controller.abort();
      req.onDropped?.("cancelado");
    }
    for (const req of this.queue) req.onDropped?.("cancelado");
    this.queue = [];
  }

  cacheHitRate(): number {
    return this.inputTokens > 0 ? this.cacheReadTokens / this.inputTokens : 0;
  }

  budgetInfo(): BudgetInfo {
    return {
      usdToday: round4(this.budget.usdToday),
      usdTotal: round4(this.budget.usdTotal),
      usdPerSimDay: this.budget.usdPerSimDay,
      usdPerRealHour: this.budget.usdPerRealHour,
      usdTotalCap: this.budget.usdTotalCap,
      inFlight: this.inFlight.size,
      queued: this.queue.length,
      mode: this.muted ? "mute" : (this.routes.mode as BudgetInfo["mode"]),
      cacheHitRate: Math.round(this.cacheHitRate() * 1000) / 1000,
    };
  }
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}
