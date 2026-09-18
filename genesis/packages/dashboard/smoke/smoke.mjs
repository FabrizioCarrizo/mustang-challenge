#!/usr/bin/env node
/**
 * Prueba de humo del dashboard contra un servidor GÉNESIS vivo.
 *
 *   BASE_URL=http://127.0.0.1:7777 SHOT_DIR=/tmp node packages/dashboard/smoke/smoke.mjs
 *
 * 1. Adelanta el mundo por la API (velocidad máxima) hasta que haya al menos
 *    una tribu y ~8 días simulados, y vuelve a 4×.
 * 2. Abre la página, espera el mapa y la población, saca capturas, hace clic
 *    sobre un ser (posición calculada con window.__genesis) y verifica el
 *    inspector y sus sub-pestañas (Familia incluida).
 * 3. Sociedad (una tribu), Crónica (hitos, capítulos), Métricas (5 gráficos +
 *    costo), Dios (susurro → aviso del servidor, un solo toast), campana.
 * 4. Replay: un snapshot atrás → cartel "Viendo el pasado", controles de ritmo
 *    apagados; "volver al presente" → cartel fuera y deltas de nuevo.
 * 5. Pantalla angosta y tema claro. Reporta errores de consola (los 404 de
 *    rutas futuras se cuentan aparte). Sale con código 1 si algo falla.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:7777";
const SHOT_DIR = process.env.SHOT_DIR ?? process.cwd();
const MIN_DAYS = Number(process.env.SMOKE_MIN_DAYS ?? 8);
const MAX_DAYS = Number(process.env.SMOKE_MAX_DAYS ?? 40);
const failures = [];
const consoleErrors = [];
/** rutas que pueden no existir en servidores viejos: si dan 404 el dashboard degrada con calma */
const OPTIONAL_ROUTES = [/\/api\/society\//, /\/api\/chronicle/, /\/api\/agents\/\d+\/(conversations|family|llm-calls)/, /\/api\/cost/];
const expected404 = [];

function check(cond, msg) {
  if (cond) console.log(`  ok   ${msg}`);
  else {
    console.log(`  FAIL ${msg}`);
    failures.push(msg);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Playwright y el Chromium preinstalado pueden diferir de versión: buscamos el binario a mano. */
function findChromium() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? "/opt/pw-browsers";
  if (!existsSync(root)) return undefined;
  const dirs = readdirSync(root).filter((d) => d.startsWith("chromium")).sort();
  for (const dir of [...dirs.filter((d) => d.startsWith("chromium-")), ...dirs.filter((d) => d.startsWith("chromium_headless_shell"))]) {
    for (const bin of ["chrome-linux/chrome", "chrome-linux/headless_shell", "chrome-linux64/chrome"]) {
      const p = join(root, dir, bin);
      if (existsSync(p)) return p;
    }
  }
  return undefined;
}

async function launch() {
  try {
    return await chromium.launch();
  } catch (err) {
    const executablePath = findChromium();
    if (!executablePath) throw err;
    console.log(`  (usando Chromium preinstalado: ${executablePath})`);
    return chromium.launch({ executablePath });
  }
}

async function apiJson(path) {
  const res = await fetch(`${BASE_URL}/api${path}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
}
async function apiPost(path, body) {
  const res = await fetch(`${BASE_URL}/api${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}`);
  return res.json();
}

/** Corre el mundo a máxima velocidad hasta tener tribus y MIN_DAYS días; vuelve a 4×. */
async function fastForward() {
  const world = await apiJson("/world");
  const tpd = world.world.ticksPerDay;
  let tick = world.clock.tick;
  let groups = await apiJson("/society/groups").catch(() => []);
  if (tick >= MIN_DAYS * tpd && groups.length > 0) {
    console.log(`  mundo ya avanzado: tick ${tick}, ${groups.length} tribus`);
    return { tpd };
  }
  console.log(`  adelantando el mundo (tick ${tick}) a máxima velocidad…`);
  await apiPost("/control", { action: "speed", value: 0 });
  const t0 = Date.now();
  while (Date.now() - t0 < 420_000) {
    await sleep(2000);
    tick = (await apiJson("/health")).tick;
    groups = await apiJson("/society/groups").catch(() => []);
    if (tick >= MIN_DAYS * tpd && groups.length > 0) break;
    if (tick >= MAX_DAYS * tpd) break;
  }
  await apiPost("/control", { action: "speed", value: 4 });
  console.log(`  tick ${tick} (día ${Math.floor(tick / tpd) + 1}), ${groups.length} tribus, ${((Date.now() - t0) / 1000).toFixed(0)} s reales`);
  return { tpd };
}

async function run() {
  const { tpd } = await fastForward();
  const browser = await launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const url = msg.location()?.url ?? "";
    if (/Failed to load resource/.test(msg.text()) && OPTIONAL_ROUTES.some((re) => re.test(url))) {
      expected404.push(url);
      return;
    }
    consoleErrors.push(`${msg.text()}${url ? ` (${url})` : ""}`);
  });
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

  console.log(`Abriendo ${BASE_URL}`);
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });

  await page.waitForSelector("canvas.map-layer-agents", { timeout: 15000 });
  check(true, "el mapa (canvas de seres) está en la página");

  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="population"]');
    return el && /^\d+$/.test(el.textContent.trim()) && Number(el.textContent) > 0;
  }, null, { timeout: 20000 });
  const population = Number(await page.textContent('[data-testid="population"]'));
  check(population > 0, `población visible: ${population}`);

  const clock = await page.textContent('[data-testid="clock"]');
  check(/año \d+ · \w+, día \d+ · \d\d:\d\d/.test(clock), `reloj formateado: "${clock}"`);

  await page.waitForFunction(() => window.__genesis && window.__genesis.getCamera().scale > 0 && window.__genesis.getState().agents > 0, null, { timeout: 10000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(SHOT_DIR, "dashboard.png") });
  console.log(`  captura: ${join(SHOT_DIR, "dashboard.png")}`);

  // ---- clic sobre un ser vivo: posición calculada desde /api/agents + cámara
  const agents = await apiJson("/agents?alive=1");
  check(agents.length > 0, `/api/agents devuelve ${agents.length} seres vivos`);
  const isolated = agents.find((a) => agents.every((b) => b.id === a.id || Math.hypot(a.x - b.x, a.y - b.y) > 2.5)) ?? agents[0];
  const target = isolated;
  const mapBox = await page.locator('[data-testid="map"]').boundingBox();
  const pos = await page.evaluate(([x, y]) => window.__genesis.worldToScreen(x + 0.5, y + 0.5), [target.x, target.y]);
  check(pos !== null, "window.__genesis.worldToScreen responde");
  const fresh = (await apiJson("/agents?alive=1")).find((a) => a.id === target.id) ?? target;
  const pos2 = await page.evaluate(([x, y]) => window.__genesis.worldToScreen(x + 0.5, y + 0.5), [fresh.x, fresh.y]);
  await page.mouse.click(mapBox.x + pos2.x, mapBox.y + pos2.y);
  let nameShown = false;
  try {
    await page.waitForSelector('[data-testid="agent-panel"] [data-testid="agent-name"]', { timeout: 8000 });
    nameShown = true;
  } catch {
    nameShown = false;
  }
  let shownName = nameShown ? (await page.textContent('[data-testid="agent-name"]')).trim() : "";
  const clickHit = nameShown && shownName === fresh.name;
  if (!clickHit) {
    console.log(`  (clic seleccionó "${shownName || "nadie"}", se esperaba "${fresh.name}"; probando selectAgent)`);
    await page.evaluate((id) => window.__genesis.selectAgent(id), target.id);
    await page.waitForFunction((name) => document.querySelector('[data-testid="agent-name"]')?.textContent.trim() === name, target.name, { timeout: 8000 });
    shownName = (await page.textContent('[data-testid="agent-name"]')).trim();
  }
  check(shownName === target.name, `el inspector muestra el nombre del ser (${shownName})${clickHit ? " tras el clic en el mapa" : " tras selectAgent()"}`);
  check(nameShown, "el clic en el mapa abrió el inspector");

  // ---- sub-pestañas del ser
  for (const label of ["Relaciones", "Conversaciones", "Pensamientos", "Familia"]) {
    await page.getByRole("button", { name: label, exact: true }).first().click();
    await page.waitForTimeout(350);
  }
  await page.waitForSelector('[data-testid="family"]', { timeout: 8000 });
  check(true, "la pestaña Familia se renderiza (árbol o estado vacío)");
  await page.screenshot({ path: join(SHOT_DIR, "dashboard-agent.png") });
  await page.getByRole("button", { name: "Mente", exact: true }).first().click();

  // ---- Sociedad: al menos una tribu
  await page.click('[data-testid="tab-sociedad"]');
  await page.waitForTimeout(900);
  const groupsApi = await apiJson("/society/groups").catch(() => []);
  let tribes = 0;
  try {
    await page.waitForSelector('[data-testid="groups"] .group', { timeout: 8000 });
    tribes = await page.locator('[data-testid="groups"] .group').count();
  } catch {
    tribes = 0;
  }
  check(tribes >= 1, `Sociedad muestra ${tribes} tribu(s) (API: ${groupsApi.length})`);
  const emptyStates = await page.locator(".society .empty").count();
  console.log(`  (secciones vacías en Sociedad: ${emptyStates})`);
  await page.screenshot({ path: join(SHOT_DIR, "dashboard-society.png") });

  // ---- Crónica: hitos y capítulos
  await page.click('[data-testid="tab-cronica"]');
  await page.waitForTimeout(900);
  let milestones = 0;
  try {
    await page.waitForSelector('[data-testid="milestones"] .milestone', { timeout: 8000 });
    milestones = await page.locator('[data-testid="milestones"] .milestone').count();
  } catch {
    milestones = 0;
  }
  check(milestones >= 1, `Crónica muestra ${milestones} hito(s)`);
  const chapters = await page.locator('[data-testid="chapters"] .chapter').count();
  const chaptersApi = await apiJson("/chronicle").catch(() => []);
  check(chapters === chaptersApi.length, `capítulos de la crónica: ${chapters} (API: ${chaptersApi.length})`);
  await page.screenshot({ path: join(SHOT_DIR, "dashboard-chronicle.png") });

  // ---- Métricas: gráficos y costo
  await page.click('[data-testid="tab-metricas"]');
  await page.waitForSelector('[data-testid="metrics-panel"]', { timeout: 5000 });
  await page.waitForTimeout(900);
  const charts = await page.locator(".uplot").count();
  check(charts === 5, `Métricas renderiza 5 gráficos uPlot (${charts})`);
  const cost = await page.locator('[data-testid="cost"]').count();
  check(cost === 1, "Métricas muestra el costo del cerebro");
  await page.screenshot({ path: join(SHOT_DIR, "dashboard-metrics.png") });

  // ---- Dios: susurro real → aviso del servidor (un solo toast)
  await page.click('[data-testid="tab-dios"]');
  await page.waitForSelector('[data-testid="god-panel"]', { timeout: 5000 });
  await page.click('[data-testid="cell-picker"]');
  await page.mouse.click(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2);
  await page.waitForTimeout(300);
  const cellText = await page.locator('[data-testid="god-cell"]').textContent();
  check(/^\d+, \d+$/.test(cellText.trim()), `el selector de celda fijó una celda (${cellText.trim()})`);
  await page.selectOption('[data-testid="god-target"]', String(target.id));
  await page.fill('[data-testid="whisper-text"]', "Buscá el agua que corre hacia el sol.");
  await page.click('[data-testid="whisper-send"]');
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="toast"]')].some((t) => /oyó la voz/.test(t.textContent)), null, { timeout: 10000 });
  await page.waitForTimeout(1500);
  const voiceToasts = await page.locator('[data-testid="toast"]', { hasText: "oyó la voz" }).count();
  check(voiceToasts === 1, `el susurro produce un solo aviso "oyó la voz" (${voiceToasts})`);
  const godLog = await page.locator('[data-testid="god-log"] .god-act__result').first().textContent();
  check(/oyó la voz/.test(godLog), `el registro de actos divinos guarda la respuesta ("${godLog.trim()}")`);
  await page.screenshot({ path: join(SHOT_DIR, "dashboard-god.png") });

  // ---- campana de avisos
  await page.click('[data-testid="bell"]');
  await page.waitForSelector('[data-testid="notice-log"]', { timeout: 3000 });
  const noticeCount = await page.locator('[data-testid="notice-log"] .notice').count();
  check(noticeCount >= 1, `la campana lista ${noticeCount} aviso(s)`);
  await page.click('[data-testid="bell"]');

  // ---- replay: un snapshot atrás y vuelta al presente
  const snapshots = await apiJson("/snapshots");
  check(snapshots.length >= 1, `/api/snapshots lista ${snapshots.length} snapshot(s)`);
  const liveBefore = await page.evaluate(() => window.__genesis.getState().liveTick);
  await page.click('[data-testid="replay-prev"]');
  await page.waitForFunction(() => window.__genesis.getState().replayTick !== null, null, { timeout: 20000 });
  const banner = await page.textContent('[data-testid="replay-banner"]');
  check(/Viendo el pasado: día \d+/.test(banner), `cartel de replay: "${banner.trim()}"`);
  const st = await page.evaluate(() => window.__genesis.getState());
  check(st.replayTick !== null && st.replayTick < liveBefore, `la vista es de un tick anterior (${st.replayTick} < ${liveBefore})`);
  const pauseDisabled = await page.getAttribute('[data-testid="pause-toggle"]', "disabled");
  check(pauseDisabled !== null, "los controles de ritmo quedan apagados en el pasado");
  const powersDisabled = await page.evaluate(() => document.querySelector(".god__powers")?.disabled === true);
  check(powersDisabled, "los poderes divinos quedan apagados en el pasado");
  const pastClock = await page.textContent('[data-testid="clock"]');
  console.log(`  (reloj en el pasado: ${pastClock.trim()})`);
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(SHOT_DIR, "dashboard-replay.png") });
  await page.click('[data-testid="replay-live"]');
  await page.waitForFunction(() => window.__genesis.getState().replayTick === null && window.__genesis.getState().replayPending === null, null, { timeout: 15000 });
  await page.waitForTimeout(1200);
  const bannerGone = (await page.locator('[data-testid="replay-banner"]').count()) === 0;
  check(bannerGone, "al volver al presente el cartel desaparece");
  const live = await page.evaluate(() => window.__genesis.getState());
  const serverTick = (await apiJson("/health")).tick;
  check(Math.abs(live.tick - serverTick) <= 3, `el reloj vuelve al presente (cliente ${live.tick}, servidor ${serverTick})`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(SHOT_DIR, "dashboard-live-again.png") });

  // ---- pausa por teclado
  await page.keyboard.press("Space");
  await page.waitForTimeout(700);
  const pauseLabel = await page.getAttribute('[data-testid="pause-toggle"]', "aria-label");
  check(pauseLabel === "reanudar" || pauseLabel === "pausar", `la barra de control refleja el estado (${pauseLabel})`);
  await page.keyboard.press("Space");

  // ---- pantalla más angosta: la barra superior puede pasar a dos filas, pero nada se recorta
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(600);
  const popBox = await page.locator('[data-testid="population"]').boundingBox();
  const panelBox = await page.locator('[data-testid="panel"]').boundingBox();
  check(popBox && popBox.x + popBox.width <= 1280 && panelBox && panelBox.x + panelBox.width <= 1280, "a 1280px nada queda fuera de la pantalla");
  const hasHScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  check(!hasHScroll, "la página no tiene scroll horizontal");
  await page.screenshot({ path: join(SHOT_DIR, "dashboard-1280.png") });

  // ---- tema claro
  const light = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  const lp = await light.newPage();
  lp.on("pageerror", (err) => consoleErrors.push(`pageerror(light): ${err.message}`));
  await lp.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await lp.waitForFunction(() => window.__genesis && window.__genesis.getState().ready, null, { timeout: 15000 });
  await lp.evaluate((id) => window.__genesis.selectAgent(id), target.id);
  await lp.waitForTimeout(1200);
  await lp.screenshot({ path: join(SHOT_DIR, "dashboard-light.png") });
  await lp.click('[data-testid="tab-sociedad"]');
  await lp.waitForTimeout(900);
  await lp.screenshot({ path: join(SHOT_DIR, "dashboard-light-society.png") });
  await light.close();

  await browser.close();

  const realErrors = consoleErrors.filter((e) => !/favicon/i.test(e));
  check(realErrors.length === 0, `sin errores de consola (${realErrors.length}; ${expected404.length} 404 de rutas opcionales)`);
  for (const e of realErrors) console.log(`    · ${e}`);

  if (failures.length) {
    console.log(`\n${failures.length} fallas`);
    process.exit(1);
  }
  console.log("\nTodo en orden.");
}

run().catch((err) => {
  console.error("smoke falló:", err);
  process.exit(1);
});
