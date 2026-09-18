import type { GenesisConfig } from "../config.ts";
import { AnthropicBrain } from "./anthropic.ts";
import { MockBrain } from "./mock.ts";
import { OllamaBrain } from "./ollama.ts";
import type { BrainProvider } from "./provider.ts";

export type BrainMode = "none" | "mock" | "claude" | "ollama" | "hybrid";

export interface BrainRoutes {
  routine: BrainProvider;
  epochal: BrainProvider;
  mode: BrainMode;
}

/** Elige proveedores por ruta según el modo y la configuración. */
export function buildRoutes(cfg: GenesisConfig, mode: BrainMode): BrainRoutes | null {
  const b = cfg.brain;
  switch (mode) {
    case "none":
      return null;
    case "mock": {
      const m = new MockBrain(b.mockLatencyMs);
      return { routine: m, epochal: m, mode };
    }
    case "claude":
      return { routine: new AnthropicBrain(b.routine), epochal: new AnthropicBrain(b.epochal), mode };
    case "ollama": {
      const o = new OllamaBrain(b.ollama.host, b.ollama.model);
      return { routine: o, epochal: o, mode };
    }
    case "hybrid":
      return { routine: new OllamaBrain(b.ollama.host, b.ollama.model), epochal: new AnthropicBrain(b.epochal), mode };
  }
}

export function parseBrainMode(v: string | undefined): BrainMode {
  switch (v) {
    case "none":
    case "mock":
    case "claude":
    case "ollama":
    case "hybrid":
      return v;
    case "anthropic":
      return "claude";
    default:
      return "mock";
  }
}
