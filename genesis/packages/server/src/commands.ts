import { AnthropicBrain, Engine, GUIDES, MAX_TOKENS, SCHEMAS, buildDailyPlan, buildWorldLaws, estimateTokens, openWorld, worldExists, Bm25Retriever, loadConfig, replayWorld, forkWorld, pruneWorld, WorldDb, worldPaths } from "@genesis/engine";

export interface CommandContext {
  values: Record<string, string | boolean | undefined>;
  worldsDir: string;
  worldName: string;
  brainMode: string;
}

/** Comandos adicionales de la CLI. */
export const commands: Record<string, (ctx: CommandContext) => Promise<void>> = {
  "brain:check": async (ctx) => {
    const cfg = loadConfig({});
    const laws = buildWorldLaws(cfg);
    const est = estimateTokens(laws) + estimateTokens(GUIDES.daily_plan);
    console.log(`Leyes del mundo: ~${estimateTokens(laws)} tokens estimados; leyes + guía del plan: ~${est} (Haiku 4.5 cachea desde 4096).`);
    const engine = Engine.genesis({ world: { size: 64, initialPopulation: 6 } }, 7);
    for (let t = 0; t < 40; t++) engine.step();
    const a = engine.s.agents.get(engine.s.alive[0]!)!;
    const built = buildDailyPlan(a, {
      s: engine.s,
      spatial: engine.spatial,
      retriever: new Bm25Retriever(),
      laws,
      groupNameOf: () => null,
      leaderNameOf: () => null,
      names: engine.names,
    });
    const routeCfg = ctx.values.model ? { ...cfg.brain.routine, model: String(ctx.values.model) } : cfg.brain.routine;
    const provider = new AnthropicBrain(routeCfg);
    console.log(`Modelo: ${provider.model}. Contando tokens del prefijo...`);
    try {
      const n = await provider.countTokens(built.system, built.user);
      console.log(`Tokens de entrada reales: ${n}`);
    } catch (err) {
      console.log(`No se pudo contar tokens: ${(err as Error).message}`);
    }
    for (let i = 1; i <= 2; i++) {
      const res = await provider.call({
        id: i,
        agentId: a.id,
        type: "daily_plan",
        route: "routine",
        system: built.system,
        user: built.user,
        schema: SCHEMAS.daily_plan,
        maxTokens: MAX_TOKENS.daily_plan,
        promptHash: built.promptHash,
      });
      console.log(
        `Llamada ${i}: ${res.status} en ${res.latencyMs} ms · entrada ${res.usage.inputTokens} · caché leída ${res.usage.cacheRead} · caché escrita ${res.usage.cacheWrite} · salida ${res.usage.outputTokens} · US$${res.usd.toFixed(5)}`,
      );
      if (res.status !== "ok") console.log(`  error: ${res.error}`);
      else {
        const out = res.parsed as { estado_animo: string; objetivos: Array<{ verbo: string; objetivo: { nombre: string } }>; nota_diario: string };
        console.log(`  ${a.name} está ${out.estado_animo}; plan: ${out.objetivos.map((o) => `${o.verbo} ${o.objetivo.nombre}`).join(", ")}`);
        console.log(`  diario: ${out.nota_diario}`);
      }
      if (i === 2 && res.usage.cacheRead === 0 && res.status === "ok") {
        console.log("  ⚠ La segunda llamada no leyó caché: revisá que el prefijo supere el mínimo del modelo y no cambie entre llamadas.");
      }
    }
    if (ctx.values.epochal) {
      const epic = new AnthropicBrain(cfg.brain.epochal);
      console.log(`Probando la ruta épica con ${epic.model}...`);
      const res = await epic.call({
        id: 3,
        agentId: a.id,
        type: "daily_plan",
        route: "epochal",
        system: built.system,
        user: built.user,
        schema: SCHEMAS.daily_plan,
        maxTokens: MAX_TOKENS.daily_plan,
        promptHash: built.promptHash,
      });
      console.log(`Épica: ${res.status} en ${res.latencyMs} ms · modelo servido ${res.model} · US$${res.usd.toFixed(5)}${res.error ? ` · ${res.error}` : ""}`);
    }
  },

  replay: async (ctx) => {
    if (!worldExists(ctx.worldsDir, ctx.worldName)) throw new Error(`No existe el mundo "${ctx.worldName}"`);
    const db = WorldDb.open(worldPaths(ctx.worldsDir, ctx.worldName).db);
    const last = Number(db.getMeta("last_tick") ?? 0);
    const from = ctx.values.from !== undefined ? Number(ctx.values.from) : 0;
    const to = ctx.values.to !== undefined ? Number(ctx.values.to) : last;
    console.log(`Reproduciendo "${ctx.worldName}" desde el snapshot anterior al tick ${from} hasta el tick ${to}...`);
    let ok = 0;
    let bad = 0;
    let unknown = 0;
    const result = await replayWorld(db, from, to, {
      onDay: (step) => {
        if (step.match === true) ok++;
        else if (step.match === false) bad++;
        else unknown++;
        if (ctx.values.verify) console.log(`  tick ${step.tick}: ${step.match === null ? "sin huella grabada" : step.match ? "coincide ✔" : `DIFIERE ✘ (${step.recordedHash} vs ${step.hash})`}`);
      },
    });
    console.log(`Listo: tick ${result.engine.s.tick}, población ${result.engine.s.alive.length}. Decisiones grabadas reusadas: ${result.intentHits}; sin grabación: ${result.intentMisses}; actos de dios: ${result.godActions}.`);
    console.log(`Huellas diarias: ${ok} coinciden, ${bad} difieren, ${unknown} sin registro.`);
    if (bad > 0) console.log("Las diferencias son esperables cuando el cerebro era un modelo real: las decisiones se reaplican en el tick más cercano, no en el exacto.");
    db.close();
  },

  fork: async (ctx) => {
    if (!worldExists(ctx.worldsDir, ctx.worldName)) throw new Error(`No existe el mundo "${ctx.worldName}"`);
    const as = String(ctx.values.as ?? `${ctx.worldName}-rama`);
    const db = WorldDb.open(worldPaths(ctx.worldsDir, ctx.worldName).db);
    const at = ctx.values.at !== undefined ? Number(ctx.values.at) : Number(db.getMeta("last_tick") ?? 0);
    const r = forkWorld(db, ctx.worldsDir, as, at);
    db.close();
    console.log(`Mundo "${r.name}" bifurcado desde "${ctx.worldName}" en el tick ${r.tick}: ${r.dir}`);
    console.log(`Corré: genesis serve --name ${r.name}`);
  },

  prune: async (ctx) => {
    if (!worldExists(ctx.worldsDir, ctx.worldName)) throw new Error(`No existe el mundo "${ctx.worldName}"`);
    const w = openWorld(ctx.worldsDir, ctx.worldName);
    const before = w.db.sizes();
    const report = pruneWorld(w.db, w.engine.config, w.engine.s.tick);
    const after = w.db.sizes();
    console.log(`Poda de "${ctx.worldName}": ${report.memoriesDeleted} memorias plegadas en ${report.memoriesFolded} resúmenes, ${report.eventsDeleted} eventos borrados, ${report.llmBodiesTrimmed} cuerpos de llamadas recortados.`);
    console.log(`Filas antes: ${JSON.stringify(before)}`);
    console.log(`Filas después: ${JSON.stringify(after)}`);
    w.db.close();
  },

  cost: async (ctx) => {
    if (!worldExists(ctx.worldsDir, ctx.worldName)) throw new Error(`No existe el mundo "${ctx.worldName}"`);
    const w = openWorld(ctx.worldsDir, ctx.worldName);
    const t = w.db.llmTotals();
    const days = Math.max(1, w.engine.s.tick / w.engine.config.time.ticksPerDay);
    console.log(`Mundo "${ctx.worldName}": ${t.calls} llamadas, US$${t.usd.toFixed(4)} en ${days.toFixed(1)} días simulados (US$${(t.usd / days).toFixed(4)} por día).`);
    const total = t.inTokens + t.cacheRead;
    console.log(`Tokens: entrada ${t.inTokens} · leídos de caché ${t.cacheRead} (${total ? ((t.cacheRead / total) * 100).toFixed(0) : 0}% del prefijo) · salida ${t.outTokens}`);
    for (const row of w.db.llmCallsByType()) console.log(`  ${row.callType.padEnd(12)} ${String(row.calls).padStart(6)} llamadas  US$${row.usd.toFixed(4)}`);
    w.db.close();
  },
};
