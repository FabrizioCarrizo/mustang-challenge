#!/usr/bin/env node
import { parseArgs } from "node:util";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createWorld, formatClock, openWorld, worldExists, type GenesisConfigInput, type TickOutput } from "@genesis/engine";
import { attachBrain } from "./brain-attach.ts";
import { Broadcaster } from "./broadcaster.ts";
import { commands } from "./commands.ts";
import { createHttpServer } from "./http.ts";
import { Runner } from "./runner.ts";

const USAGE = `GÉNESIS — simulación de civilización digital emergente

Uso: genesis <comando> [opciones]

Comandos:
  new       crea un mundo nuevo           --name eden --seed 42 --agents 40 --size 128 [--config archivo.json]
  run       corre N días sin interfaz     --name eden --days 30 [--brain none|mock|claude|ollama]
  serve     corre el mundo con dashboard  --name eden [--port 7777] [--brain ...] [--preset cronica] [--paused]
  inspect   muestra un ser                --name eden --agent 3
  doctor    verifica el entorno
  replay    reproduce la historia grabada --name eden [--from tick] [--to tick] [--verify]
  fork      bifurca un mundo en un tick   --name eden --at tick --as eden-rama
  prune     poda memorias y eventos       --name eden
  brain:check  prueba el cerebro LLM      [--model ...] [--epochal]
  cost      resume el gasto en tokens     --name eden

Variables: GENESIS_WORLDS (carpeta de mundos, por defecto ./worlds), GENESIS_PORT, GENESIS_BRAIN, GENESIS_WORLD
`;

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    name: { type: "string" },
    seed: { type: "string" },
    agents: { type: "string" },
    size: { type: "string" },
    config: { type: "string" },
    days: { type: "string" },
    brain: { type: "string" },
    port: { type: "string" },
    preset: { type: "string" },
    speed: { type: "string" },
    paused: { type: "boolean" },
    agent: { type: "string" },
    from: { type: "string" },
    to: { type: "string" },
    at: { type: "string" },
    as: { type: "string" },
    epochal: { type: "boolean" },
    verify: { type: "boolean" },
    model: { type: "string" },
    worlds: { type: "string" },
    quiet: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
});

const command = positionals[0];
const worldsDir = resolve(values.worlds ?? process.env.GENESIS_WORLDS ?? "worlds");
const worldName = values.name ?? process.env.GENESIS_WORLD ?? "eden";
const brainMode = values.brain ?? process.env.GENESIS_BRAIN ?? "mock";

function loadConfigFile(path: string | undefined): GenesisConfigInput {
  if (!path) return {};
  const full = resolve(path);
  if (!existsSync(full)) throw new Error(`No existe el archivo de configuración ${full}`);
  return JSON.parse(readFileSync(full, "utf8")) as GenesisConfigInput;
}

/** Configuración de un mundo nuevo: archivo + banderas --agents/--size. */
function newWorldConfig(): GenesisConfigInput {
  const input = loadConfigFile(values.config);
  input.world = { ...(input.world ?? {}) };
  if (values.agents) input.world.initialPopulation = Number(values.agents);
  if (values.size) input.world.size = Number(values.size);
  return input;
}

function daySummary(day: number, out: TickOutput, runner: Runner): string {
  const s = runner.engine.s;
  const m = out.metrics;
  const needs = m ? `sed ${m.avgNeeds.sed.toFixed(2)} ham ${m.avgNeeds.hambre.toFixed(2)} cal ${m.avgNeeds.calor.toFixed(2)} soc ${m.avgNeeds.social.toFixed(2)} sen ${m.avgNeeds.sentido.toFixed(2)}` : "";
  const d = out.newDay ? s.yesterday : s.today;
  const brain = runner.brain ? ` · llamadas ${d.llmCalls} (US$${d.usd.toFixed(3)}) charlas ${d.dialogues} creencias ${s.beliefs.size}` : "";
  const groups = runner.society.groupsInfo();
  const society = ` · tribus ${groups.length}${groups.some((g) => g.leaderId !== null) ? " (con líder)" : ""} · leyes ${runner.society.lawsInfo().filter((l) => l.active).length}`;
  return `día ${String(day).padStart(4)} · ${formatClock(s.clock).padEnd(34)} · ${s.climate.weather.padEnd(9)} ${s.climate.temperature.toFixed(1).padStart(5)}° · pob ${String(s.alive.length).padStart(3)} · nac ${d.births} · muertes ${d.deaths} · estr ${s.structures.size} · ${needs}${brain}${society}`;
}

function unusedDaySummary(day: number, out: TickOutput, runner: Runner): string {
  const s = runner.engine.s;
  const m = out.metrics;
  const needs = m ? "" : "";
  const d = out.newDay ? s.yesterday : s.today;
  const brain = "";
  return `día ${String(day).padStart(4)} · ${formatClock(s.clock).padEnd(34)} · ${s.climate.weather.padEnd(9)} ${s.climate.temperature.toFixed(1).padStart(5)}° · pob ${String(s.alive.length).padStart(3)} · nac ${d.births} · muertes ${d.deaths} · estr ${s.structures.size} · ${needs}${brain}`;
}

async function main(): Promise<void> {
  if (values.help || !command) {
    console.log(USAGE);
    return;
  }
  switch (command) {
    case "new": {
      const seed = Number(values.seed ?? Math.floor(Math.random() * 1_000_000));
      const w = createWorld(worldsDir, worldName, seed, newWorldConfig());
      console.log(`Mundo "${worldName}" creado con seed ${seed}: ${w.engine.s.alive.length} seres en una grilla de ${w.engine.s.grid.size}×${w.engine.s.grid.size}.`);
      console.log(`Carpeta: ${w.db.dir}`);
      w.db.close();
      return;
    }
    case "run": {
      const days = Number(values.days ?? 10);
      const w = worldExists(worldsDir, worldName)
        ? openWorld(worldsDir, worldName)
        : createWorld(worldsDir, worldName, Number(values.seed ?? 42), newWorldConfig());
      if (w.resumedFromTick > 0) w.db.deleteAfterTick(w.resumedFromTick);
      const runner = new Runner(w, { multiplier: Infinity });
      await attachBrain(runner, brainMode);
      console.log(`Corriendo ${days} días de "${worldName}" desde el tick ${w.engine.s.tick} (cerebro: ${brainMode})`);
      const t0 = Date.now();
      await runner.runDays(days, (d, out) => {
        if (!values.quiet) console.log(daySummary(d, out, runner));
      });
      runner.takeSnapshot();
      const secs = (Date.now() - t0) / 1000;
      console.log(`Listo: tick ${w.engine.s.tick}, población ${w.engine.s.alive.length}, ${secs.toFixed(1)} s (${((days * w.engine.config.time.ticksPerDay) / secs).toFixed(0)} ticks/s)`);
      printChronicleSummary(runner);
      await runner.stop();
      return;
    }
    case "serve": {
      const port = Number(values.port ?? process.env.GENESIS_PORT ?? 7777);
      const w = worldExists(worldsDir, worldName)
        ? openWorld(worldsDir, worldName)
        : createWorld(worldsDir, worldName, Number(values.seed ?? 42), newWorldConfig());
      if (w.resumedFromTick > 0) w.db.deleteAfterTick(w.resumedFromTick);
      const runner = new Runner(w, { preset: values.preset, multiplier: values.speed ? Number(values.speed) : undefined });
      await attachBrain(runner, brainMode);
      const broadcaster = new Broadcaster(runner);
      const app = await createHttpServer(runner, broadcaster);
      await app.listen({ port, host: "127.0.0.1" });
      console.log(`GÉNESIS sirviendo "${worldName}" en http://127.0.0.1:${port}  (tick ${w.engine.s.tick}, ${w.engine.s.alive.length} seres, cerebro ${brainMode}, preset ${runner.preset})`);
      if (!values.paused) runner.start();
      else console.log("Mundo en pausa: usá el botón ▶ del dashboard.");
      const shutdown = async () => {
        console.log("\nGuardando el mundo...");
        broadcaster.close();
        await runner.stop();
        await app.close();
        process.exit(0);
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
      return;
    }
    case "inspect": {
      const w = openWorld(worldsDir, worldName);
      const id = Number(values.agent ?? w.engine.s.alive[0]);
      const a = w.engine.s.agents.get(id);
      if (!a) throw new Error(`No existe el ser ${id}`);
      console.log(`${a.name} (#${a.id}, ${a.sex}) · edad ${w.engine.ageYears(a).toFixed(2)} años · salud ${a.health.toFixed(2)} · ${a.diedTick === null ? "vivo" : `murió de ${a.causeOfDeath}`}`);
      console.log("necesidades:", Object.fromEntries(Object.entries(a.needs).map(([k, v]) => [k, Number(v.toFixed(2))])));
      console.log("rasgos:", Object.fromEntries(Object.entries(a.genome).map(([k, v]) => [k, Number(v.toFixed(2))])));
      console.log("mochila:", Object.fromEntries([...a.inventory.entries()].map(([k, v]) => [k, Number(v.toFixed(1))])));
      console.log("sabe:", [...a.knows].join(", "), "· casa:", a.home ? `${a.home.x},${a.home.y}` : "ninguna");
      console.log("memorias recientes:");
      for (const m of a.memories.slice(-12)) console.log(`  [${m.importance}] t${m.tick} ${m.text}`);
      w.db.close();
      return;
    }
    case "doctor": {
      console.log(`Node ${process.version} (${process.platform}/${process.arch})`);
      const { openDriver } = await import("@genesis/engine");
      const d = openDriver(":memory:");
      console.log(`SQLite: ${d.backend} ✔`);
      d.close();
      console.log(`ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? "definida ✔" : "no definida (el cerebro Claude no va a funcionar; usá --brain mock)"}`);
      console.log(`Carpeta de mundos: ${worldsDir}`);
      return;
    }
    default: {
      const extra = commands[command];
      if (extra) {
        await extra({ values: values as Record<string, string | boolean | undefined>, worldsDir, worldName, brainMode });
        return;
      }
      console.log(`Comando desconocido: ${command}\n`);
      console.log(USAGE);
      process.exitCode = 1;
    }
  }
}

function printChronicleSummary(runner: Runner): void {
  const db = runner.db;
  const deaths = db.events({ kind: "agent.died", limit: 10, order: "desc" });
  const discoveries = db.events({ kind: "discovery", limit: 10, order: "desc" });
  const milestones = db.milestones(20);
  if (milestones.length) {
    console.log("\nHitos:");
    for (const m of milestones) console.log(`  t${m.tick} ${m.title}`);
  }
  if (discoveries.length) {
    console.log("\nDescubrimientos recientes:");
    for (const d of discoveries) console.log(`  t${d.tick} ${runner.engine.names.name(d.agent_id)} descubrió ${d.label}`);
  }
  if (deaths.length) {
    console.log("\nÚltimas muertes:");
    for (const d of deaths) console.log(`  t${d.tick} ${runner.engine.names.name(d.agent_id)} murió de ${d.label}`);
  }
}

main().catch((err) => {
  console.error(`Error: ${(err as Error).message}`);
  if (process.env.GENESIS_DEBUG) console.error(err);
  process.exit(1);
});
