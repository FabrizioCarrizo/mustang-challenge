import { Brain, PACING_PRESETS, buildRoutes, parseBrainMode } from "@genesis/engine";
import type { Runner } from "./runner.ts";

/**
 * Conecta el cerebro (System 2) al runner: rutas por modo, presupuesto,
 * densidad del preset y freno del mundo cuando las mentes se atrasan.
 */
export async function attachBrain(runner: Runner, mode: string): Promise<void> {
  const m = parseBrainMode(mode);
  const routes = buildRoutes(runner.engine.config, m);
  if (!routes) return;
  const density = PACING_PRESETS[runner.preset]?.callDensity ?? 1;
  const brain = new Brain(runner.engine, routes, runner.db, { density, society: runner.society });
  brain.install();
  runner.brain = brain;
  runner.budgetProvider = () => brain.budgetInfo();
  runner.backpressure = () => brain.backpressure();
  runner.yieldEvery = 1;
  if (m === "claude" && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    runner.emit("notice", { level: "warn", text: "No hay ANTHROPIC_API_KEY: las llamadas a Claude van a fallar (usá `ant auth login` o --brain mock)" });
  }
}
