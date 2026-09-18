import type { AgentSummary, GodAction, ResourceKind, Weather } from "@genesis/protocol";
import { RESOURCES, WEATHERS } from "@genesis/protocol";
import { useMemo, useState } from "react";
import { NoticeList } from "../components/NoticeList.tsx";
import { sendControl } from "../components/TopBar.tsx";
import { Empty, Section } from "../components/ui.tsx";
import { DISASTERS, RESOURCE_LABELS, WEATHER_LABELS } from "../lib/labels.ts";
import { socket } from "../lib/ws.ts";
import { useUiStore } from "../store/uiStore.ts";
import { isReplaying, useWorldStore } from "../store/worldStore.ts";

const SPEEDS: Array<{ value: number; label: string }> = [
  { value: 0.25, label: "0.25×" },
  { value: 1, label: "1×" },
  { value: 4, label: "4×" },
  { value: 16, label: "16×" },
  { value: 0, label: "máx" },
];

type DisasterType = (typeof DISASTERS)[number]["value"];

function sendGod(action: GodAction, label: string): void {
  useUiStore.getState().pushGodAct(label);
  socket.send({ t: "god", action });
}

function wallTime(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

export function GodPanel() {
  const pacing = useWorldStore((s) => s.pacing);
  const replaying = useWorldStore((s) => isReplaying(s));
  const agentsVersion = useWorldStore((s) => s.agentsVersion);
  const selectedId = useUiStore((s) => s.selectedId);
  const pickedCell = useUiStore((s) => s.pickedCell);
  const cellPicker = useUiStore((s) => s.cellPicker);
  const setCellPicker = useUiStore((s) => s.setCellPicker);
  const pushToast = useUiStore((s) => s.pushToast);
  const godActs = useUiStore((s) => s.godActs);
  const select = useUiStore((s) => s.select);

  const { alive, dead } = useMemo(() => {
    const alive: AgentSummary[] = [];
    const dead: AgentSummary[] = [];
    for (const a of useWorldStore.getState().agents.values()) (a.alive ? alive : dead).push(a);
    const byName = (a: AgentSummary, b: AgentSummary) => a.name.localeCompare(b.name, "es");
    return { alive: alive.sort(byName), dead: dead.sort(byName) };
  }, [agentsVersion]);
  const selected = selectedId !== null ? useWorldStore.getState().agents.get(selectedId) : undefined;
  const selectedName = selectedId !== null ? (selected?.name ?? `#${selectedId}`) : null;

  const [targetChoice, setTargetChoice] = useState<number | "selected">("selected");
  const [whisper, setWhisper] = useState("");
  const [revelation, setRevelation] = useState("");
  const [resource, setResource] = useState<ResourceKind>("comida");
  const [amount, setAmount] = useState(20);
  const [radius, setRadius] = useState(3);
  const [disaster, setDisaster] = useState<DisasterType>("tormenta");
  const [disasterAtCell, setDisasterAtCell] = useState(false);
  const [weather, setWeather] = useState<Weather>("lluvia");
  const [weatherDays, setWeatherDays] = useState(1);
  const [spawnCount, setSpawnCount] = useState(3);

  const targetId = targetChoice === "selected" ? selectedId : targetChoice;
  const target = targetId !== null ? useWorldStore.getState().agents.get(targetId) : undefined;
  const targetName = targetId !== null ? (target?.name ?? `#${targetId}`) : null;
  const targetDead = target ? !target.alive : false;
  const paused = pacing?.paused ?? true;

  const needCell = (): boolean => {
    if (pickedCell) return true;
    pushToast("warn", "Primero elegí una celda en el mapa.");
    return false;
  };
  const needTarget = (): boolean => {
    if (targetId !== null) return true;
    pushToast("warn", "Primero elegí un ser.");
    return false;
  };
  const cellLabel = pickedCell ? `${pickedCell.x}, ${pickedCell.y}` : "ninguna";

  return (
    <div className="god" data-testid="god-panel">
      {replaying && <div className="replay-note">Mientras se mira el pasado los poderes están apagados: volvé al presente para actuar.</div>}
      <fieldset className="god__powers" disabled={replaying}>
        <Section title="Ritmo">
          <div className="toolbar">
            <button type="button" className="btn" onClick={() => sendControl(paused ? "play" : "pause")}>
              {paused ? "▶ reanudar" : "⏸ pausar"}
            </button>
            <div className="segmented" role="group" aria-label="velocidad">
              {SPEEDS.map((s) => (
                <button key={s.label} type="button" className={`btn btn--seg${!paused && pacing?.multiplier === s.value ? " btn--active" : ""}`} onClick={() => sendControl("speed", s.value)}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          {paused && <p className="muted small">En pausa, cada acto divino hace avanzar el mundo un instante para aplicarse.</p>}
        </Section>

        <Section title="Objetivo">
          <div className="god-target">
            <label className="field field--grow">
              ser
              <select
                className="select"
                value={targetChoice === "selected" ? "selected" : String(targetChoice)}
                onChange={(e) => setTargetChoice(e.target.value === "selected" ? "selected" : Number(e.target.value))}
                aria-label="ser objetivo"
                data-testid="god-target"
              >
                <option value="selected">{selectedName ? `ser seleccionado (${selectedName})` : "ser seleccionado (ninguno)"}</option>
                <optgroup label="vivos">
                  {alive.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} #{a.id}
                    </option>
                  ))}
                </optgroup>
                {dead.length > 0 && (
                  <optgroup label="muertos recientes">
                    {dead.map((a) => (
                      <option key={a.id} value={a.id}>
                        † {a.name} #{a.id}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
            <div className="god-target__cell">
              <span className="muted">celda</span> <strong className="num" data-testid="god-cell">{cellLabel}</strong>
              <button type="button" className={`btn btn--sm${cellPicker ? " btn--active" : ""}`} onClick={() => setCellPicker(!cellPicker)} data-testid="cell-picker">
                {cellPicker ? "eligiendo… (clic en el mapa)" : "elegir celda"}
              </button>
            </div>
            {targetId !== null && (
              <div className="muted small">
                objetivo: <button type="button" className="link" onClick={() => select(targetId)}>{targetName}</button>
                {targetDead ? " (muerto: se puede resucitar)" : ""}
              </div>
            )}
          </div>
        </Section>

        <Section title="Voz">
          <div className="form">
            <textarea className="input" rows={2} placeholder="susurro: una voz que no viene de nadie…" value={whisper} onChange={(e) => setWhisper(e.target.value)} aria-label="susurro" data-testid="whisper-text" />
            <div className="toolbar">
              <button
                type="button"
                className="btn"
                disabled={targetId === null || !whisper.trim() || targetDead}
                onClick={() => {
                  if (!needTarget()) return;
                  sendGod({ kind: "whisper", agentId: targetId!, text: whisper.trim() }, `susurro a ${targetName}`);
                  setWhisper("");
                }}
                data-testid="whisper-send"
              >
                susurrar
              </button>
              <span className="muted small">lo recuerda como una voz divina</span>
            </div>
            <input className="input" placeholder="revelación: lo convierte en profeta de una creencia…" value={revelation} onChange={(e) => setRevelation(e.target.value)} aria-label="revelación" />
            <div className="toolbar">
              <button
                type="button"
                className="btn"
                disabled={targetId === null || !revelation.trim() || targetDead}
                onClick={() => {
                  if (!needTarget()) return;
                  sendGod({ kind: "prophet", agentId: targetId!, revelation: revelation.trim() }, `revelación a ${targetName}`);
                  setRevelation("");
                }}
              >
                hacer profeta
              </button>
              <span className="muted small">siembra una creencia cosmológica</span>
            </div>
          </div>
        </Section>

        <Section title={`Sobre ${targetName ?? "el ser objetivo"}`}>
          <div className="toolbar toolbar--wrap">
            <button type="button" className="btn" disabled={targetId === null || targetDead} onClick={() => needTarget() && sendGod({ kind: "heal", agentId: targetId! }, `sanar a ${targetName}`)}>
              sanar
            </button>
            <button type="button" className="btn" disabled={targetId === null || !targetDead} onClick={() => needTarget() && sendGod({ kind: "resurrect", agentId: targetId! }, `resucitar a ${targetName}`)} title="solo para muertos recientes">
              resucitar
            </button>
            <button
              type="button"
              className="btn"
              disabled={targetId === null || targetDead}
              onClick={() => {
                if (!needTarget() || !needCell()) return;
                sendGod({ kind: "teleport", agentId: targetId!, x: pickedCell!.x, y: pickedCell!.y }, `teletransportar a ${targetName} a ${cellLabel}`);
              }}
              title="a la celda elegida"
            >
              teletransportar
            </button>
            <button type="button" className="btn btn--danger" disabled={targetId === null || targetDead} onClick={() => needTarget() && sendGod({ kind: "smite", agentId: targetId! }, `fulminar a ${targetName}`)}>
              fulminar
            </button>
          </div>
        </Section>

        <Section title="Recursos">
          <div className="form form--row">
            <select className="select" value={resource} onChange={(e) => setResource(e.target.value as ResourceKind)} aria-label="recurso">
              {RESOURCES.map((r) => (
                <option key={r} value={r}>
                  {RESOURCE_LABELS[r]}
                </option>
              ))}
            </select>
            <label className="field">
              cantidad
              <input className="input input--num" type="number" min={1} max={50} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
            </label>
            <label className="field">
              radio
              <input className="input input--num" type="number" min={0} max={12} value={radius} onChange={(e) => setRadius(Number(e.target.value))} />
            </label>
            <button
              type="button"
              className="btn"
              onClick={() => {
                if (!needCell()) return;
                sendGod({ kind: "spawn_resource", x: pickedCell!.x, y: pickedCell!.y, resource, amount, radius }, `${RESOURCE_LABELS[resource].toLowerCase()} ×${amount} en ${cellLabel} (radio ${radius})`);
              }}
            >
              hacer brotar en la celda
            </button>
          </div>
        </Section>

        <Section title="Desastre">
          <div className="form form--row">
            <select className="select" value={disaster} onChange={(e) => setDisaster(e.target.value as DisasterType)} aria-label="desastre">
              {DISASTERS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
            <label className="check" title="el terremoto usa la celda como epicentro">
              <input type="checkbox" checked={disasterAtCell} onChange={(e) => setDisasterAtCell(e.target.checked)} /> en la celda elegida
            </label>
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => {
                if (disasterAtCell && !needCell()) return;
                const label = DISASTERS.find((d) => d.value === disaster)?.label ?? disaster;
                sendGod(disasterAtCell && pickedCell ? { kind: "disaster", type: disaster, x: pickedCell.x, y: pickedCell.y } : { kind: "disaster", type: disaster }, `desastre: ${label}${disasterAtCell && pickedCell ? ` en ${cellLabel}` : ""}`);
              }}
            >
              desatar
            </button>
          </div>
        </Section>

        <Section title="Clima">
          <div className="form form--row">
            <select className="select" value={weather} onChange={(e) => setWeather(e.target.value as Weather)} aria-label="clima">
              {WEATHERS.map((w) => (
                <option key={w} value={w}>
                  {WEATHER_LABELS[w].label}
                </option>
              ))}
            </select>
            <label className="field">
              días
              <input className="input input--num" type="number" min={1} max={30} value={weatherDays} onChange={(e) => setWeatherDays(Number(e.target.value))} />
            </label>
            <button type="button" className="btn" onClick={() => sendGod({ kind: "weather", weather, days: weatherDays }, `clima: ${WEATHER_LABELS[weather].label} por ${weatherDays} día${weatherDays === 1 ? "" : "s"}`)}>
              imponer
            </button>
          </div>
        </Section>

        <Section title="Nuevos seres">
          <div className="form form--row">
            <label className="field">
              cantidad
              <input className="input input--num" type="number" min={1} max={50} value={spawnCount} onChange={(e) => setSpawnCount(Number(e.target.value))} />
            </label>
            <button
              type="button"
              className="btn"
              onClick={() => {
                if (!needCell()) return;
                sendGod({ kind: "spawn_agent", x: pickedCell!.x, y: pickedCell!.y, count: spawnCount }, `${spawnCount} seres nuevos en ${cellLabel}`);
              }}
            >
              crear en la celda
            </button>
          </div>
        </Section>
      </fieldset>

      <Section title="Actos divinos recientes">
        {godActs.length === 0 ? (
          <Empty>Todavía no interviniste.</Empty>
        ) : (
          <ul className="list god-log" data-testid="god-log">
            {godActs.map((a) => (
              <li key={a.id} className={`god-act${a.ok === false ? " god-act--fail" : ""}`}>
                <span className="muted num">{wallTime(a.at)}</span>
                <span className="god-act__label">{a.label}</span>
                <span className={`god-act__result${a.ok === null ? " muted" : ""}`}>{a.result ?? "esperando respuesta…"}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Avisos del servidor">
        <NoticeList limit={8} />
      </Section>
    </div>
  );
}
