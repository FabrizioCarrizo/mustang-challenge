#!/usr/bin/env node
/**
 * Prueba de humo del dashboard contra un servidor GÉNESIS vivo.
 *
 *   BASE_URL=http://127.0.0.1:7777 SHOT_DIR=/tmp node packages/dashboard/smoke/smoke.mjs
 *
 * Abre la página, espera el mapa y la población, saca capturas, hace clic
 * sobre un ser (posición calculada con window.__genesis), verifica que el
 * inspector muestre su nombre, recorre las pestañas Métricas y Crónica y
 * reporta los errores de consola. Sale con código 1 si algo falla.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:7777";
const SHOT_DIR = process.env.SHOT_DIR ?? process.cwd();
const failures = [];
const consoleErrors = [];
/** rutas de fases futuras: el dashboard las pide y degrada con calma si dan 404 */
const FUTURE_ROUTES = [/\/api\/society\//, /\/api\/chronicle/, /\/api\/agents\/\d+\/conversations/];
const expected404 = [];

function check(cond, msg) {
  if (cond) console.log(`  ok   ${msg}`);
  else {
    console.log(`  FAIL ${msg}`);
    failures.push(msg);
  }
}

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

async function run() {
  const browser = await launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const url = msg.location()?.url ?? "";
    if (/Failed to load resource/.test(msg.text()) && FUTURE_ROUTES.some((re) => re.test(url))) {
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

  // que la cámara ya esté ajustada y haya seres en el store
  await page.waitForFunction(() => window.__genesis && window.__genesis.getCamera().scale > 0 && window.__genesis.getState().agents > 0, null, { timeout: 10000 });
  await page.waitForTimeout(1200); // un par de cuadros de render
  await page.screenshot({ path: join(SHOT_DIR, "dashboard.png") });
  console.log(`  captura: ${join(SHOT_DIR, "dashboard.png")}`);

  // clic sobre un ser vivo: posición calculada desde /api/agents + cámara
  const agents = await apiJson("/agents?alive=1");
  check(agents.length > 0, `/api/agents devuelve ${agents.length} seres vivos`);
  // elegimos uno sin vecinos a menos de 2 celdas para que el clic sea inequívoco
  const isolated =
    agents.find((a) => agents.every((b) => b.id === a.id || Math.hypot(a.x - b.x, a.y - b.y) > 2.5)) ?? agents[0];
  const target = isolated;
  const mapBox = await page.locator('[data-testid="map"]').boundingBox();
  const pos = await page.evaluate(([x, y]) => window.__genesis.worldToScreen(x + 0.5, y + 0.5), [target.x, target.y]);
  check(pos !== null, "window.__genesis.worldToScreen responde");
  // el ser puede haberse movido desde la lectura del API: releemos justo antes del clic
  const fresh = (await apiJson("/agents?alive=1")).find((a) => a.id === target.id) ?? target;
  const pos2 = await page.evaluate(([x, y]) => window.__genesis.worldToScreen(x + 0.5, y + 0.5), [fresh.x, fresh.y]);
  await page.mouse.click(mapBox.x + pos2.x, mapBox.y + pos2.y);
  let nameShown = false;
  try {
    await page.waitForFunction(
      (id) => {
        const el = document.querySelector('[data-testid="agent-name"]');
        const p = document.querySelector('[data-testid="agent-panel"]');
        return !!el && !!p && el.textContent.trim().length > 0;
      },
      target.id,
      { timeout: 8000 },
    );
    nameShown = true;
  } catch {
    nameShown = false;
  }
  let shownName = nameShown ? (await page.textContent('[data-testid="agent-name"]')).trim() : "";
  const clickHit = nameShown && shownName === fresh.name;
  if (!clickHit) {
    // los seres se mueven: si el clic cayó en otro, lo aceptamos como acierto parcial y probamos el gancho
    console.log(`  (clic seleccionó "${shownName || "nadie"}", se esperaba "${fresh.name}"; probando selectAgent)`);
    await page.evaluate((id) => window.__genesis.selectAgent(id), target.id);
    await page.waitForFunction((name) => document.querySelector('[data-testid="agent-name"]')?.textContent.trim() === name, target.name, { timeout: 8000 });
    shownName = (await page.textContent('[data-testid="agent-name"]')).trim();
  }
  check(shownName === target.name, `el inspector muestra el nombre del ser (${shownName})${clickHit ? " tras el clic en el mapa" : " tras selectAgent()"}`);
  check(nameShown, "el clic en el mapa abrió el inspector");

  // sub-pestañas del ser
  for (const label of ["Relaciones", "Familia", "Pensamientos", "Conversaciones", "Mente"]) {
    await page.getByRole("button", { name: label, exact: true }).first().click();
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(SHOT_DIR, "dashboard-agent.png") });

  // Métricas
  await page.click('[data-testid="tab-metricas"]');
  await page.waitForSelector('[data-testid="metrics-panel"]', { timeout: 5000 });
  await page.waitForTimeout(800);
  const charts = await page.locator(".uplot").count();
  check(charts === 5, `Métricas renderiza 5 gráficos uPlot (${charts})`);
  await page.screenshot({ path: join(SHOT_DIR, "dashboard-metrics.png") });

  // Crónica
  await page.click('[data-testid="tab-cronica"]');
  await page.waitForTimeout(800);
  const chron = await page.locator(".chronicle").count();
  check(chron === 1, "Crónica se renderiza");
  await page.screenshot({ path: join(SHOT_DIR, "dashboard-chronicle.png") });

  // Sociedad y Dios
  await page.click('[data-testid="tab-sociedad"]');
  await page.waitForTimeout(600);
  const emptyStates = await page.locator(".society .empty").count();
  check(emptyStates >= 1, `Sociedad degrada con estados vacíos (${emptyStates})`);
  await page.screenshot({ path: join(SHOT_DIR, "dashboard-society.png") });
  await page.click('[data-testid="tab-dios"]');
  await page.waitForSelector('[data-testid="god-panel"]', { timeout: 5000 });
  await page.click('[data-testid="cell-picker"]');
  await page.mouse.click(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2);
  await page.waitForTimeout(300);
  const cellText = await page.locator(".god-target strong.num").first().textContent();
  check(/^\d+, \d+$/.test(cellText.trim()), `el selector de celda fijó una celda (${cellText.trim()})`);
  const toastsBefore = await page.locator('[data-testid="toast"]').count();
  await page.getByRole("button", { name: "imponer" }).click();
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid="toast"]').length > n, toastsBefore, { timeout: 5000 });
  const toast = await page.locator('[data-testid="toast"]').last().textContent();
  check(/divin|hecho|no se pudo/i.test(toast), `un poder divino produce un aviso del servidor: "${toast.trim()}"`);
  await page.screenshot({ path: join(SHOT_DIR, "dashboard-god.png") });

  // pausa por teclado
  await page.keyboard.press("Space");
  await page.waitForTimeout(700);
  const pauseLabel = await page.getAttribute('[data-testid="pause-toggle"]', "aria-label");
  check(pauseLabel === "reanudar" || pauseLabel === "pausar", `la barra de control refleja el estado (${pauseLabel})`);
  await page.keyboard.press("Space");

  // pantalla más angosta: la barra superior puede pasar a dos filas, pero nada se recorta
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(600);
  const popBox = await page.locator('[data-testid="population"]').boundingBox();
  const panelBox = await page.locator('[data-testid="panel"]').boundingBox();
  check(popBox && popBox.x + popBox.width <= 1280 && panelBox && panelBox.x + panelBox.width <= 1280, "a 1280px nada queda fuera de la pantalla");
  const hasHScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  check(!hasHScroll, "la página no tiene scroll horizontal");
  await page.screenshot({ path: join(SHOT_DIR, "dashboard-1280.png") });

  // tema claro
  const light = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  const lp = await light.newPage();
  lp.on("pageerror", (err) => consoleErrors.push(`pageerror(light): ${err.message}`));
  await lp.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await lp.waitForFunction(() => window.__genesis && window.__genesis.getState().ready, null, { timeout: 15000 });
  await lp.evaluate((id) => window.__genesis.selectAgent(id), target.id);
  await lp.waitForTimeout(1200);
  await lp.screenshot({ path: join(SHOT_DIR, "dashboard-light.png") });
  await lp.click('[data-testid="tab-metricas"]');
  await lp.waitForTimeout(900);
  await lp.screenshot({ path: join(SHOT_DIR, "dashboard-light-metrics.png") });
  await light.close();

  await browser.close();

  const realErrors = consoleErrors.filter((e) => !/favicon/i.test(e));
  check(realErrors.length === 0, `sin errores de consola (${realErrors.length}; ${expected404.length} 404 esperados de rutas futuras)`);
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
