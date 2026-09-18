import { EventEmitter } from "node:events";
import type { BudgetInfo, PacingInfo } from "@genesis/protocol";
import { PACING_PRESETS, type Engine, type OpenedWorld, type PersistenceWriter, type TickOutput, type WorldDb } from "@genesis/engine";

export interface RunnerEvents {
  tick: [TickOutput];
  snapshot: [{ tick: number; bytes: number; hash: string }];
  notice: [{ level: "info" | "warn" | "error"; text: string }];
}

/**
 * Corre el mundo a un ritmo dado. El control visible es "segundos reales por
 * día simulado" × multiplicador. Con multiplicador infinito corre a máxima
 * velocidad en tandas cortas para no bloquear el servidor.
 */
export class Runner extends EventEmitter<RunnerEvents> {
  readonly engine: Engine;
  readonly db: WorldDb;
  readonly writer: PersistenceWriter;
  paused = true;
  multiplier = 1;
  simDayRealSeconds: number;
  preset: string;
  private timer: NodeJS.Timeout | null = null;
  private immediate: NodeJS.Immediate | null = null;
  private stopping = false;
  private lastWall = 0;
  private carry = 0;
  private tpsWindow: number[] = [];
  private tpsWindowStart = 0;
  private ticksInWindow = 0;
  measuredTicksPerSecond = 0;
  /** proveedor externo del presupuesto (cerebro); por defecto sin gasto */
  budgetProvider: (() => BudgetInfo) | null = null;
  /** freno externo: si devuelve true, el mundo espera (ej. cola de planes atrasada) */
  backpressure: (() => boolean) | null = null;

  constructor(world: OpenedWorld, opts: { preset?: string; multiplier?: number; simDayRealSeconds?: number } = {}) {
    super();
    this.engine = world.engine;
    this.db = world.db;
    this.writer = world.writer;
    const cfgPacing = this.engine.config.pacing;
    this.preset = opts.preset ?? cfgPacing.preset;
    const presetDef = PACING_PRESETS[this.preset];
    this.simDayRealSeconds = opts.simDayRealSeconds ?? presetDef?.simDayRealSeconds ?? cfgPacing.simDayRealSeconds;
    this.multiplier = opts.multiplier ?? cfgPacing.multiplier;
  }

  get tick(): number {
    return this.engine.s.tick;
  }

  /** Ticks por segundo objetivo (Infinity = máxima velocidad). */
  get targetTicksPerSecond(): number {
    if (!Number.isFinite(this.multiplier)) return Infinity;
    return (this.engine.config.time.ticksPerDay / this.simDayRealSeconds) * this.multiplier;
  }

  pacing(): PacingInfo {
    return {
      paused: this.paused,
      multiplier: Number.isFinite(this.multiplier) ? this.multiplier : 0,
      simDayRealSeconds: this.simDayRealSeconds,
      preset: this.preset,
      measuredTicksPerSecond: Math.round(this.measuredTicksPerSecond * 10) / 10,
    };
  }

  budget(): BudgetInfo {
    if (this.budgetProvider) return this.budgetProvider();
    const b = this.engine.config.budget;
    return {
      usdToday: 0,
      usdTotal: 0,
      usdPerSimDay: b.usdPerSimDay,
      usdPerRealHour: b.usdPerRealHour,
      usdTotalCap: b.usdTotal,
      inFlight: 0,
      queued: 0,
      mode: "none",
      cacheHitRate: 0,
    };
  }

  setPreset(name: string): void {
    const def = PACING_PRESETS[name];
    if (!def) return;
    this.preset = name;
    this.simDayRealSeconds = def.simDayRealSeconds;
    this.emit("notice", { level: "info", text: `Preset de ritmo: ${name} (${def.description})` });
  }

  setMultiplier(m: number): void {
    this.multiplier = m <= 0 ? Infinity : m;
    this.carry = 0;
  }

  /** Un tick completo: mundo + persistencia + snapshot periódico. */
  step(): TickOutput {
    const out = this.engine.step();
    this.writer.write(out);
    const every = this.engine.config.persistence.snapshotEveryTicks;
    if (out.tick % every === 0) this.takeSnapshot();
    this.emit("tick", out);
    return out;
  }

  takeSnapshot(): void {
    const r = this.writer.snapshot();
    const tpd = this.engine.config.time.ticksPerDay;
    if (r.tick % (tpd * 7) === 0) this.db.thinSnapshots(7, 7, tpd);
    this.emit("snapshot", r);
  }

  /** Corre N días a máxima velocidad de forma síncrona (uso headless). */
  runDays(days: number, onDay?: (day: number, out: TickOutput) => void): void {
    const tpd = this.engine.config.time.ticksPerDay;
    for (let d = 0; d < days; d++) {
      let last: TickOutput | null = null;
      for (let t = 0; t < tpd; t++) last = this.step();
      onDay?.(d + 1, last!);
    }
    this.writer.flush();
  }

  start(): void {
    if (!this.paused) return;
    this.paused = false;
    this.lastWall = Date.now();
    this.carry = 0;
    this.schedule(0);
    this.emit("notice", { level: "info", text: "El mundo vuelve a girar" });
  }

  pause(): void {
    this.paused = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.immediate) clearImmediate(this.immediate);
    this.timer = null;
    this.immediate = null;
    this.writer.flush();
    this.emit("notice", { level: "info", text: "Mundo en pausa" });
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.pause();
    this.takeSnapshot();
    this.db.close();
  }

  private schedule(ms: number): void {
    if (this.paused || this.stopping) return;
    if (ms <= 0) this.immediate = setImmediate(() => this.loop());
    else this.timer = setTimeout(() => this.loop(), ms);
  }

  private loop(): void {
    if (this.paused || this.stopping) return;
    const now = Date.now();
    if (this.backpressure?.()) {
      this.lastWall = now;
      this.schedule(50);
      return;
    }
    const tps = this.targetTicksPerSecond;
    let toRun: number;
    if (!Number.isFinite(tps)) {
      toRun = 20;
    } else {
      const elapsed = (now - this.lastWall) / 1000;
      this.carry += elapsed * tps;
      toRun = Math.min(60, Math.floor(this.carry));
      this.carry -= toRun;
    }
    this.lastWall = now;
    for (let i = 0; i < toRun; i++) {
      try {
        this.step();
      } catch (err) {
        this.emit("notice", { level: "error", text: `Error en el tick ${this.tick}: ${(err as Error).message}` });
        this.pause();
        return;
      }
    }
    this.measure(toRun, now);
    if (!Number.isFinite(tps)) this.schedule(0);
    else this.schedule(Math.max(5, Math.min(250, 1000 / tps)));
  }

  private measure(ticks: number, now: number): void {
    if (this.tpsWindowStart === 0) this.tpsWindowStart = now;
    this.ticksInWindow += ticks;
    if (now - this.tpsWindowStart >= 1000) {
      this.measuredTicksPerSecond = (this.ticksInWindow * 1000) / (now - this.tpsWindowStart);
      this.tpsWindowStart = now;
      this.ticksInWindow = 0;
      this.tpsWindow.push(this.measuredTicksPerSecond);
      if (this.tpsWindow.length > 10) this.tpsWindow.shift();
    }
  }
}
