import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { fmtUsd } from "../lib/format.ts";
import { WEATHER_LABELS } from "../lib/labels.ts";
import { formatClock } from "../lib/time.ts";
import { socket } from "../lib/ws.ts";
import { type ThemeMode, useUiStore } from "../store/uiStore.ts";
import { countAlive, isReplaying, useWorldStore } from "../store/worldStore.ts";
import { NoticeList } from "./NoticeList.tsx";

const SPEEDS: Array<{ value: number; label: string }> = [
  { value: 0.25, label: "0.25×" },
  { value: 1, label: "1×" },
  { value: 4, label: "4×" },
  { value: 16, label: "16×" },
  { value: 0, label: "máx" },
];

const PRESETS = ["contemplativo", "cronica", "local", "mock"];

export function sendControl(action: "pause" | "play" | "speed" | "preset", value?: number | string): void {
  socket.send({ t: "control", action, value });
}

export function TopBar() {
  const { world, clock, climate, epoch, budget, pacing, connection, attempt, ready, replaying } = useWorldStore(
    useShallow((s) => ({
      world: s.world,
      clock: s.clock,
      climate: s.climate,
      epoch: s.epoch,
      budget: s.budget,
      pacing: s.pacing,
      connection: s.connection,
      attempt: s.reconnectAttempt,
      ready: s.ready,
      replaying: isReplaying(s),
    })),
  );
  const agentsVersion = useWorldStore((s) => s.agentsVersion);
  const population = useMemo(() => countAlive(useWorldStore.getState().agents), [agentsVersion]);
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const panelOpen = useUiStore((s) => s.panelOpen);
  const togglePanel = useUiStore((s) => s.togglePanel);

  const weather = climate ? (WEATHER_LABELS[climate.weather] ?? { icon: "", label: climate.weather }) : null;
  const paused = pacing?.paused ?? true;
  const multiplier = pacing?.multiplier ?? 1;

  return (
    <header className="topbar">
      <div className="topbar__group topbar__brand">
        <span className="brand">GÉNESIS</span>
        <span className="brand__world" title="mundo">
          {world?.name ?? "…"}
        </span>
        {epoch && (
          <span className="brand__epoch" title={`época: ${epoch}`}>
            {epoch}
          </span>
        )}
      </div>

      <div className="topbar__group topbar__clock">
        <span className={`clock num${replaying ? " clock--past" : ""}`} data-testid="clock" title={replaying ? "momento del pasado que se está viendo" : undefined}>
          {clock ? formatClock(clock) : "—"}
        </span>
        {climate && weather && (
          <span className="pill" title={`${weather.label}${climate.drought ? " · sequía" : ""}`}>
            <span aria-hidden>{weather.icon}</span> <span className="pill__label">{weather.label}</span> <span className="num">{climate.temperature.toFixed(1)}°</span>
          </span>
        )}
        <span className="pill" title="seres vivos">
          <span className="muted">población</span> <strong className="num" data-testid="population">{ready ? population : "—"}</strong>
        </span>
      </div>

      <div className="topbar__group topbar__controls" title={replaying ? "el ritmo no se toca mientras se mira el pasado" : undefined}>
        <button
          className={`btn btn--icon${paused ? " btn--play" : ""}`}
          onClick={() => sendControl(paused ? "play" : "pause")}
          disabled={replaying}
          title={paused ? "reanudar (espacio)" : "pausar (espacio)"}
          aria-label={paused ? "reanudar" : "pausar"}
          data-testid="pause-toggle"
        >
          {paused ? "▶" : "⏸"}
        </button>
        <div className="segmented" role="group" aria-label="velocidad">
          {SPEEDS.map((s) => (
            <button
              key={s.label}
              className={`btn btn--seg${!paused && multiplier === s.value ? " btn--active" : ""}`}
              onClick={() => sendControl("speed", s.value)}
              disabled={replaying}
              title={s.value === 0 ? "máxima velocidad" : `velocidad ${s.label}`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <select className="select" value={pacing?.preset ?? "cronica"} onChange={(e) => sendControl("preset", e.target.value)} disabled={replaying} title="preset de ritmo" aria-label="preset">
          {PRESETS.concat(pacing && !PRESETS.includes(pacing.preset) ? [pacing.preset] : []).map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <span className="pill num" title="ticks por segundo medidos">
          {pacing ? pacing.measuredTicksPerSecond.toFixed(1) : "—"} <span className="muted">ticks/s</span>
        </span>
      </div>

      <div className="topbar__group topbar__budget">{budget && <BudgetMeter usdToday={budget.usdToday} perDay={budget.usdPerSimDay} total={budget.usdTotal} cap={budget.usdTotalCap} mode={budget.mode} />}</div>

      <div className="topbar__group topbar__status">
        {connection !== "open" && (
          <span className="badge badge--bad" data-testid="disconnected">
            {connection === "connecting" ? "conectando…" : `desconectado · reintento ${attempt}`}
          </span>
        )}
        <Bell />
        <button
          className="btn btn--sm btn--ghost btn--icon"
          onClick={() => setTheme(nextTheme(theme))}
          title={`tema: ${theme === "auto" ? "automático" : theme === "dark" ? "oscuro" : "claro"} (clic para cambiar)`}
          aria-label="cambiar tema"
        >
          {theme === "auto" ? "◐" : theme === "dark" ? "●" : "○"}
        </button>
        <button className="btn btn--sm btn--ghost btn--icon" onClick={togglePanel} title={panelOpen ? "ocultar panel" : "mostrar panel"} aria-label="panel lateral">
          {panelOpen ? "⟩" : "⟨"}
        </button>
      </div>
    </header>
  );
}

/** Campana con los últimos avisos del servidor. */
function Bell() {
  const open = useUiStore((s) => s.noticesOpen);
  const unread = useUiStore((s) => s.unreadNotices);
  const toggle = useUiStore((s) => s.toggleNotices);
  return (
    <div className="bell">
      <button type="button" className={`btn btn--sm btn--ghost bell__btn${open ? " btn--active" : ""}`} onClick={() => toggle()} aria-expanded={open} title="avisos del servidor" aria-label="avisos del servidor" data-testid="bell">
        <span aria-hidden>⚑</span>
        <span className="bell__label">avisos</span>
        {unread > 0 && <span className="bell__count num">{unread}</span>}
      </button>
      {open && (
        <div className="bell__pop" data-testid="notice-log">
          <div className="bell__head">
            <strong>Últimos avisos</strong>
            <button type="button" className="btn btn--xs btn--ghost" onClick={() => toggle(false)} aria-label="cerrar">
              ✕
            </button>
          </div>
          <NoticeList />
        </div>
      )}
    </div>
  );
}

function nextTheme(t: ThemeMode): ThemeMode {
  return t === "auto" ? "dark" : t === "dark" ? "light" : "auto";
}

function BudgetMeter({ usdToday, perDay, total, cap, mode }: { usdToday: number; perDay: number; total: number; cap: number; mode: string }) {
  const dayPct = perDay > 0 ? Math.min(1, usdToday / perDay) : 0;
  const totalPct = cap > 0 ? Math.min(1, total / cap) : 0;
  const level = (p: number) => (p >= 0.9 ? "meter__fill--bad" : p >= 0.6 ? "meter__fill--warn" : "");
  return (
    <div className="budget" title={`presupuesto: ${fmtUsd(usdToday)} de ${fmtUsd(perDay)} hoy · ${fmtUsd(total)} de ${fmtUsd(cap, 0)} en total · modo ${mode}`}>
      <div className="budget__row">
        <span className="muted">hoy</span>
        <span className="meter">
          <span className={`meter__fill ${level(dayPct)}`} style={{ width: `${dayPct * 100}%` }} />
        </span>
        <span className="num">
          {fmtUsd(usdToday)}
          <span className="muted">/{fmtUsd(perDay, 0)}</span>
        </span>
      </div>
      <div className="budget__row">
        <span className="muted">total</span>
        <span className="meter">
          <span className={`meter__fill ${level(totalPct)}`} style={{ width: `${totalPct * 100}%` }} />
        </span>
        <span className="num">
          {fmtUsd(total)}
          <span className="muted">/{fmtUsd(cap, 0)}</span>
        </span>
      </div>
      <span className="badge budget__mode">{mode}</span>
    </div>
  );
}
