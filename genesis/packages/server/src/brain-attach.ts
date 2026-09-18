import type { Runner } from "./runner.ts";

/**
 * Conecta el cerebro (System 2) al runner. En la fase 1 solo existe System 1:
 * los modos "none" y "mock" corren sin llamadas; los demás avisan.
 */
export async function attachBrain(runner: Runner, mode: string): Promise<void> {
  void runner;
  if (mode === "none" || mode === "mock") return;
  console.warn(`El cerebro "${mode}" todavía no está disponible; corriendo solo con System 1.`);
}
