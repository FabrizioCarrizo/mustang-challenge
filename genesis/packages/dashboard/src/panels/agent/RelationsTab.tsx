import type { AgentDetail, RelationshipInfo } from "@genesis/protocol";
import { type SimulationLinkDatum, type SimulationNodeDatum, forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from "d3-force";
import { useMemo } from "react";
import { AgentLink, Empty } from "../../components/ui.tsx";
import { clamp, truncate } from "../../lib/format.ts";
import { useUiStore } from "../../store/uiStore.ts";

const GRAPH_W = 396;
const GRAPH_H = 230;
const GRAPH_TOP = 12;

interface GNode extends SimulationNodeDatum {
  id: number;
  name: string;
  self: boolean;
}
interface GLink extends SimulationLinkDatum<GNode> {
  familiarity: number;
}

export function RelationsTab({ d }: { d: AgentDetail }) {
  const rels = d.relationships;
  if (rels.length === 0) return <Empty>Todavía no conoce a nadie.</Empty>;
  return (
    <div className="rels">
      <RelationGraph self={{ id: d.id, name: d.name }} rels={rels.slice(0, GRAPH_TOP)} />
      <ul className="list rel-list">
        {rels.map((r) => (
          <li key={r.id} className="rel">
            <div className="rel__head">
              <AgentLink id={r.id} name={r.name} />
              {r.label && <span className="badge">{r.label}</span>}
              {r.kinship > 0 && (
                <span className="muted small" title="parentesco">
                  parentesco {r.kinship.toFixed(2)}
                </span>
              )}
            </div>
            <div className="rel__bars">
              <MiniBar label="confianza" value={r.trust} />
              <MiniBar label="afinidad" value={r.affinity} diverging />
              <MiniBar label="familiaridad" value={r.familiarity} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MiniBar({ label, value, diverging }: { label: string; value: number; diverging?: boolean }) {
  const v = clamp(value, -1, 1);
  return (
    <span className="minibar" title={`${label} ${value.toFixed(2)}`}>
      <span className="minibar__label">{label}</span>
      <span className={`minibar__track${diverging ? " minibar__track--div" : ""}`}>
        {diverging ? (
          <span
            className="minibar__fill"
            style={{
              left: v >= 0 ? "50%" : `${50 + v * 50}%`,
              width: `${Math.abs(v) * 50}%`,
              background: v >= 0 ? "var(--good)" : "var(--bad)",
            }}
          />
        ) : (
          <span className="minibar__fill" style={{ left: 0, width: `${clamp(v, 0, 1) * 100}%`, background: "var(--accent-2)" }} />
        )}
      </span>
      <span className="minibar__value num">{value.toFixed(2)}</span>
    </span>
  );
}

function affinityColor(a: number): string {
  if (a > 0.1) return "var(--good)";
  if (a < -0.1) return "var(--bad)";
  return "var(--muted)";
}

/** Grafo de fuerzas (d3-force, calculado de una vez) de las relaciones más fuertes. */
function RelationGraph({ self, rels }: { self: { id: number; name: string }; rels: RelationshipInfo[] }) {
  const select = useUiStore((s) => s.select);
  const key = rels.map((r) => r.id).join(",");
  const layout = useMemo(() => {
    const nodes: GNode[] = [{ id: self.id, name: self.name, self: true, fx: GRAPH_W / 2, fy: GRAPH_H / 2 }];
    for (const r of rels) nodes.push({ id: r.id, name: r.name, self: false });
    const links: GLink[] = rels.map((r) => ({ source: self.id, target: r.id, familiarity: clamp(r.familiarity, 0, 1) }));
    const sim = forceSimulation<GNode>(nodes)
      .force(
        "link",
        forceLink<GNode, GLink>(links)
          .id((n) => n.id)
          .distance((l) => 55 + 55 * (1 - l.familiarity)),
      )
      .force("charge", forceManyBody().strength(-170))
      .force("center", forceCenter(GRAPH_W / 2, GRAPH_H / 2))
      .force("collide", forceCollide(18))
      .stop();
    for (let i = 0; i < 220; i++) sim.tick();
    for (const n of nodes) {
      n.x = clamp(n.x ?? GRAPH_W / 2, 24, GRAPH_W - 24);
      n.y = clamp(n.y ?? GRAPH_H / 2, 16, GRAPH_H - 16);
    }
    return { nodes, links };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, self.id, self.name]);

  const byId = new Map(rels.map((r) => [r.id, r]));
  return (
    <svg className="graph" viewBox={`0 0 ${GRAPH_W} ${GRAPH_H}`} role="img" aria-label="grafo de relaciones">
      {layout.links.map((l) => {
        const s = l.source as GNode;
        const t = l.target as GNode;
        const r = byId.get(t.id);
        if (!r) return null;
        return (
          <line
            key={t.id}
            x1={s.x}
            y1={s.y}
            x2={t.x}
            y2={t.y}
            stroke={affinityColor(r.affinity)}
            strokeWidth={1 + 3 * clamp(r.familiarity, 0, 1)}
            strokeOpacity={0.8}
          />
        );
      })}
      {layout.nodes.map((n) => (
        <g key={n.id} transform={`translate(${n.x ?? 0},${n.y ?? 0})`} className="graph__node" onClick={() => !n.self && select(n.id)} style={{ cursor: n.self ? "default" : "pointer" }}>
          <circle r={n.self ? 9 : 6.5} fill={n.self ? "var(--accent)" : "var(--panel-3)"} stroke="var(--border-strong)" strokeWidth={1.5} />
          <text y={n.self ? 20 : 17} textAnchor="middle" className="graph__label">
            {truncate(n.name, 14)}
          </text>
        </g>
      ))}
    </svg>
  );
}
