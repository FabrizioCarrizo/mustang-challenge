import type { AgentSummary, GodAction, ResourceKind, Weather } from "@genesis/protocol";
import { RESOURCES, WEATHERS } from "@genesis/protocol";
import { useMemo, useState } from "react";
import { sendControl } from "../components/TopBar.tsx";
import { Section } from "../components/ui.tsx";
import { DISASTERS, RESOURCE_LABELS, WEATHER_LABELS } from "../lib/labels.ts";
import { socket } from "../lib/ws.ts";
import { useUiStore } from "../store/uiStore.ts";
import { useWorldStore } from "../store/worldStore.ts";

const SPEEDS: Array<{ value: number; label: string }> = [
  { value: 0.25, label: "0.25×" },
  { value: 1, label: "1×" },
  { value: 4, label: "4×" },
  { value: 16, label: "16×" },
  { value: 0, label: "máx" },
];

function sendGod(action: GodAction): void {
  socket.send({ t: "god", action });
}

export function GodPanel() {
  const pacing = useWorldStore((s) => s.pacing);
  const agentsVersion = useWorldStore((s) => s.agentsVersion);
  const selectedId = useUiStore((s) => s.selectedId);
  const pickedCell = useUiStore((s) => s.pickedCell);
  const cellPicker = useUiStore((s) => s.cellPicker);
  const setCellPicker = useUiStore((s) => s.setCellPicker);
  const pushToast = useUiStore((s) => s.pushToast);

  const alive = useMemo(() => {
    const out: AgentSummary[] = [];
    for (const a of useWorldStore.getState().agents.values()) if (a.alive) out.push(a);
    return out.sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [agentsVersion]);
  const selectedName = selectedId !== null ? (useWorldStore.getState().agents.get(selectedId)?.name ?? `#${selectedId}`) : null;

  const [whisperTarget, setWhisperTarget] = useState<number | "selected">("selected");
  const [whisper, setWhisper] = useState("");
  const [revelation, setRevelation] = useState("");
  const [resource, setResource] = useState<ResourceKind>("comida");
  const [amount, setAmount] = useState(20);
  const [radius, setRadius] = useState(3);
  const [disaster, setDisaster] = useState<(typeof DISASTERS)[number]["value"]>("tormenta");
  const [disasterAtCell, setDisasterAtCell] = useState(false);
  const [weather, setWeather] = useState<Weather>("lluvia");
  const [weatherDays, setWeatherDays] = useState(1);
  const [spawnCount, setSpawnCount] = useState(3);

  const targetId = whisperTarget === "selected" ? selectedId : whisperTarget;
  const paused = pacing?.paused ?? true;
  const needCell = (): boolean => {
    if (pickedCell) return true;
    pushToast("warn", "Primero elegí una celda en el mapa.");
    return false;
  };
  const needAgent = (): boolean => {
    if (selectedId !== null) return true;
    pushToast("warn", "Primero seleccioná un ser.");
    return false;
  };

  return (
    <div className="god" data-testid="god-panel">
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
      </Section>

      <Section title="Objetivo">
        <div className="god-target">
          <div>
            <span className="muted">celda</span>{" "}
            <strong className="num">{pickedCell ? `${pickedCell.x}, ${pickedCell.y}` : "ninguna"}</strong>
          </div>
          <button type="button" className={`btn btn--sm${cellPicker ? " btn--active" : ""}`} onClick={() => setCellPicker(!cellPicker)} data-testid="cell-picker">
            {cellPicker ? "eligiendo… (clic en el mapa)" : "elegir celda"}
          </button>
          <div>
            <span className="muted">ser</span> <strong>{selectedName ?? "ninguno"}</strong>
          </div>
        </div>
      </Section>

      <Section title="Susurro">
        <div className="form">
          <select className="select" value={whisperTarget === "selected" ? "selected" : String(whisperTarget)} onChange={(e) => setWhisperTarget(e.target.value === "selected" ? "selected" : Number(e.target.value))} aria-label="destinatario">
            <option value="selected">{selectedName ? `ser seleccionado (${selectedName})` : "ser seleccionado (ninguno)"}</option>
            {alive.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} #{a.id}
              </option>
            ))}
          </select>
          <textarea className="input" rows={2} placeholder="una voz en su cabeza…" value={whisper} onChange={(e) => setWhisper(e.target.value)} aria-label="susurro" />
          <div className="toolbar">
            <button
              type="button"
              className="btn"
              disabled={targetId === null || !whisper.trim()}
              onClick={() => {
                if (targetId === null) return;
                sendGod({ kind: "whisper", agentId: targetId, text: whisper.trim() });
              }}
            >
              susurrar
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={targetId === null || !revelation.trim()}
              onClick={() => {
                if (targetId === null) return;
                sendGod({ kind: "prophet", agentId: targetId, revelation: revelation.trim() });
              }}
              title="convertirlo en profeta con una revelación"
            >
              hacer profeta
            </button>
          </div>
          <input className="input" placeholder="revelación para el profeta…" value={revelation} onChange={(e) => setRevelation(e.target.value)} aria-label="revelación" />
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
            <input className="input input--num" type="number" min={1} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
          </label>
          <label className="field">
            radio
            <input className="input input--num" type="number" min={0} max={30} value={radius} onChange={(e) => setRadius(Number(e.target.value))} />
          </label>
          <button
            type="button"
            className="btn"
            onClick={() => {
              if (!needCell()) return;
              sendGod({ kind: "spawn_resource", x: pickedCell!.x, y: pickedCell!.y, resource, amount, radius });
            }}
          >
            hacer brotar
          </button>
        </div>
      </Section>

      <Section title="Desastre">
        <div className="form form--row">
          <select className="select" value={disaster} onChange={(e) => setDisaster(e.target.value as (typeof DISASTERS)[number]["value"])} aria-label="desastre">
            {DISASTERS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
          <label className="check">
            <input type="checkbox" checked={disasterAtCell} onChange={(e) => setDisasterAtCell(e.target.checked)} /> en la celda elegida
          </label>
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => {
              if (disasterAtCell && !needCell()) return;
              sendGod(disasterAtCell && pickedCell ? { kind: "disaster", type: disaster, x: pickedCell.x, y: pickedCell.y } : { kind: "disaster", type: disaster });
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
          <button type="button" className="btn" onClick={() => sendGod({ kind: "weather", weather, days: weatherDays })}>
            imponer
          </button>
        </div>
      </Section>

      <Section title={`Sobre ${selectedName ?? "el ser seleccionado"}`}>
        <div className="toolbar toolbar--wrap">
          <button type="button" className="btn" disabled={selectedId === null} onClick={() => needAgent() && sendGod({ kind: "heal", agentId: selectedId! })}>
            sanar
          </button>
          <button type="button" className="btn" disabled={selectedId === null} onClick={() => needAgent() && sendGod({ kind: "resurrect", agentId: selectedId! })}>
            resucitar
          </button>
          <button
            type="button"
            className="btn"
            disabled={selectedId === null}
            onClick={() => {
              if (!needAgent() || !needCell()) return;
              sendGod({ kind: "teleport", agentId: selectedId!, x: pickedCell!.x, y: pickedCell!.y });
            }}
            title="a la celda elegida"
          >
            teletransportar
          </button>
          <button type="button" className="btn btn--danger" disabled={selectedId === null} onClick={() => needAgent() && sendGod({ kind: "smite", agentId: selectedId! })}>
            fulminar
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
              sendGod({ kind: "spawn_agent", x: pickedCell!.x, y: pickedCell!.y, count: spawnCount });
            }}
          >
            crear en la celda
          </button>
        </div>
      </Section>
      <p className="muted small">Cada poder viaja por WebSocket como {"{t:\"god\"}"}; la respuesta del servidor aparece como aviso.</p>
    </div>
  );
}
