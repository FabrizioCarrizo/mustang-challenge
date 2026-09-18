import type { AgentDetail, AgentSummary } from "@genesis/protocol";
import { ITEMS, NEEDS, TRAITS } from "@genesis/protocol";
import { useEffect, useMemo, useState } from "react";
import { Bar, Chip, Empty, KeyValue, Loading } from "../components/ui.tsx";
import { apiGet } from "../lib/api.ts";
import { STATUS_FILL, needColor } from "../lib/colors.ts";
import { fmtPct } from "../lib/format.ts";
import { NEED_LABELS, SEX_LABELS, STATUS_LABELS, TRAIT_LABELS, verbLabel } from "../lib/labels.ts";
import { formatTickLong } from "../lib/time.ts";
import { type AgentSubTab, useUiStore } from "../store/uiStore.ts";
import { useWorldStore } from "../store/worldStore.ts";
import { ConversationsTab } from "./agent/ConversationsTab.tsx";
import { FamilyTab } from "./agent/FamilyTab.tsx";
import { MindTab } from "./agent/MindTab.tsx";
import { RelationsTab } from "./agent/RelationsTab.tsx";
import { ThoughtsTab } from "./agent/ThoughtsTab.tsx";

const SUBTABS: Array<[AgentSubTab, string]> = [
  ["mente", "Mente"],
  ["relaciones", "Relaciones"],
  ["conversaciones", "Conversaciones"],
  ["familia", "Familia"],
  ["pensamientos", "Pensamientos"],
];

export function AgentPanel() {
  const selectedId = useUiStore((s) => s.selectedId);
  const focus = useWorldStore((s) => s.focus);
  const setFocus = useWorldStore((s) => s.setFocus);

  useEffect(() => {
    setFocus(null);
    if (selectedId === null) return;
    const ctrl = new AbortController();
    void apiGet<AgentDetail>(`/agents/${selectedId}`, ctrl.signal).then((r) => {
      if (ctrl.signal.aborted) return;
      if (r.status === "ok") setFocus(r.data);
      else if (r.status === "missing") useUiStore.getState().pushToast("warn", `No existe el ser #${selectedId}`);
    });
    return () => ctrl.abort();
  }, [selectedId, setFocus]);

  if (selectedId === null) return <AgentPicker />;
  const d = focus && focus.id === selectedId ? focus : null;
  if (!d) return <Loading>cargando al ser #{selectedId}…</Loading>;
  return <AgentDetailView d={d} />;
}

/** Sin selección: lista filtrable de seres vivos para elegir uno. */
function AgentPicker() {
  const agentsVersion = useWorldStore((s) => s.agentsVersion);
  const select = useUiStore((s) => s.select);
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const all: AgentSummary[] = [];
    for (const a of useWorldStore.getState().agents.values()) if (a.alive) all.push(a);
    all.sort((a, b) => a.name.localeCompare(b.name, "es"));
    const needle = q.trim().toLowerCase();
    return needle ? all.filter((a) => a.name.toLowerCase().includes(needle) || String(a.id) === needle) : all;
  }, [agentsVersion, q]);
  return (
    <div className="picker">
      <Empty>Hacé clic en un ser del mapa para inspeccionarlo, o elegilo de la lista.</Empty>
      <input className="input" placeholder="buscar por nombre o id…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="buscar ser" />
      <ul className="list list--dense">
        {list.slice(0, 80).map((a) => (
          <li key={a.id}>
            <button type="button" className="row-btn" onClick={() => select(a.id)}>
              <span className="dot" style={{ background: STATUS_FILL[a.st] }} />
              <span className="row-btn__main">{a.name}</span>
              <span className="muted num">#{a.id}</span>
              <span className="muted">{STATUS_LABELS[a.st]}</span>
              <span className="muted num">{a.age.toFixed(1)} a</span>
            </button>
          </li>
        ))}
        {list.length > 80 && <li className="muted">… y {list.length - 80} más</li>}
      </ul>
    </div>
  );
}

function AgentDetailView({ d }: { d: AgentDetail }) {
  const subTab = useUiStore((s) => s.agentSubTab);
  const setSubTab = useUiStore((s) => s.setAgentSubTab);
  const panTo = useUiStore((s) => s.panTo);
  const tpd = useWorldStore((s) => s.world?.ticksPerDay ?? 144);
  const dead = !d.alive;
  const inventory = ITEMS.filter((k) => (d.inventory[k] ?? 0) > 0);

  return (
    <div className="agent" data-testid="agent-panel">
      <header className="agent-head">
        <div className="agent-head__row">
          <h2 className="agent-head__name" data-testid="agent-name">
            {d.name}
          </h2>
          <span className="muted num">#{d.id}</span>
          <span className="status" style={{ ["--status-color" as string]: STATUS_FILL[d.st] }}>
            {STATUS_LABELS[d.st]}
          </span>
          {d.pregnant && <span className="badge">embarazada</span>}
        </div>
        <div className="agent-head__meta muted">
          {SEX_LABELS[d.sex] ?? d.sex} · <span className="num">{d.age.toFixed(1)}</span> años · {d.lifeStage}
          {d.g !== null && d.groupName && <> · {d.groupName}</>}
          {" · "}
          <button type="button" className="link" onClick={() => panTo(d.x, d.y)} title="centrar el mapa en este ser">
            en {d.x}, {d.y}
          </button>
        </div>
        {dead && (
          <div className="agent-dead">
            Murió {d.diedTick !== null ? formatTickLong(d.diedTick, tpd) : ""}
            {d.causeOfDeath ? ` de ${d.causeOfDeath}` : ""}.
          </div>
        )}
        <Bar value={d.health} label="salud" color={needColor(d.health)} right={fmtPct(d.health)} />
        {(d.injuries > 0 || d.disease > 0) && (
          <div className="muted small">
            {d.injuries > 0 && <>heridas {fmtPct(d.injuries)} </>}
            {d.disease > 0 && <>enfermedad {fmtPct(d.disease)}</>}
          </div>
        )}
        <KeyValue
          items={[
            ["acción", d.current ? verbLabel(d.current) : d.alive ? verbLabel(d.act) : "—"],
            ["ánimo", d.mood ?? "—"],
            ["hogar", d.home ? `${d.home.x}, ${d.home.y}` : "sin hogar"],
            ["tribu", d.groupName ?? "ninguna"],
          ]}
        />
        <details className="fold">
          <summary>genoma cultural</summary>
          {d.culturalGenome ? <p className="prose">{d.culturalGenome}</p> : <p className="muted">todavía vacío: se forma con la experiencia (fase 2).</p>}
        </details>
      </header>

      <section className="section">
        <h3 className="section__title">Necesidades</h3>
        <div className="needs">
          {NEEDS.map((n) => (
            <Bar key={n} value={d.needs[n]} label={NEED_LABELS[n]} color={needColor(d.needs[n])} right={fmtPct(d.needs[n])} />
          ))}
        </div>
      </section>

      <section className="section">
        <h3 className="section__title">Rasgos</h3>
        <div className="traits">
          {TRAITS.map((t) => (
            <Bar key={t} value={d.traits[t]} label={TRAIT_LABELS[t]} color="var(--accent-2)" right={(d.traits[t] ?? 0).toFixed(2)} thin />
          ))}
        </div>
      </section>

      <section className="section">
        <h3 className="section__title">Mochila</h3>
        {inventory.length === 0 ? (
          <div className="muted">vacía</div>
        ) : (
          <div className="chips">
            {inventory.map((k) => (
              <Chip key={k}>
                {k} <span className="num">×{d.inventory[k]}</span>
              </Chip>
            ))}
          </div>
        )}
        {d.knows.length > 0 && (
          <div className="chips chips--muted" title="conocimientos">
            {d.knows.map((k) => (
              <Chip key={k}>{k}</Chip>
            ))}
          </div>
        )}
        {d.plan.length > 0 && (
          <ol className="plan">
            {d.plan.map((p, i) => (
              <li key={i} className={p.done ? "plan__done" : ""}>
                <span className="muted num">{p.prioridad}</span> {verbLabel(p.verbo)} <span className="muted">{p.objetivo}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <nav className="subtabs" aria-label="secciones del ser">
        {SUBTABS.map(([key, label]) => (
          <button key={key} type="button" className={`subtab${subTab === key ? " subtab--active" : ""}`} onClick={() => setSubTab(key)}>
            {label}
          </button>
        ))}
      </nav>
      <div className="subtab-body">
        {subTab === "mente" && <MindTab id={d.id} />}
        {subTab === "relaciones" && <RelationsTab d={d} />}
        {subTab === "conversaciones" && <ConversationsTab id={d.id} />}
        {subTab === "familia" && <FamilyTab d={d} />}
        {subTab === "pensamientos" && <ThoughtsTab id={d.id} />}
      </div>
    </div>
  );
}
