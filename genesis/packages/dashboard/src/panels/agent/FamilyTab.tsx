import type { AgentDetail } from "@genesis/protocol";
import { AgentLink, Empty, KeyValue } from "../../components/ui.tsx";
import { STATUS_LABELS } from "../../lib/labels.ts";
import { useWorldStore } from "../../store/worldStore.ts";

const PARTNER_RE = /pareja|espos|compañer|amante|vínculo|vinculo|casad|cónyuge|conyuge/i;

export function FamilyTab({ d }: { d: AgentDetail }) {
  const agents = useWorldStore((s) => s.agents);
  const agentsVersion = useWorldStore((s) => s.agentsVersion);
  void agentsVersion;
  const partners = d.relationships.filter((r) => r.label && PARTNER_RE.test(r.label));
  const parents = d.parents.filter((p): p is number => p !== null);
  const kin = d.relationships.filter((r) => r.kinship > 0 && !parents.includes(r.id) && !d.children.includes(r.id)).slice(0, 12);

  const person = (id: number) => {
    const a = agents.get(id);
    return (
      <span className="person">
        <AgentLink id={id} name={a?.name} />
        {a ? (
          <span className="muted small">
            {" "}
            {STATUS_LABELS[a.st]} · {a.age.toFixed(1)} a
          </span>
        ) : (
          <span className="muted small"> (fuera del mapa)</span>
        )}
      </span>
    );
  };

  if (parents.length === 0 && d.children.length === 0 && partners.length === 0 && kin.length === 0) {
    return <Empty>Sin familia conocida: los primeros seres nacieron sin padres.</Empty>;
  }
  return (
    <div className="family">
      <KeyValue
        items={[
          ["padres", parents.length ? <span className="people">{parents.map((p) => <span key={p}>{person(p)}</span>)}</span> : <span className="muted">desconocidos</span>],
          [
            "pareja",
            partners.length ? (
              <span className="people">
                {partners.map((p) => (
                  <span key={p.id}>
                    {person(p.id)} <span className="badge">{p.label}</span>
                  </span>
                ))}
              </span>
            ) : (
              <span className="muted">sin pareja</span>
            ),
          ],
          [
            `hijos (${d.children.length})`,
            d.children.length ? <span className="people">{d.children.map((c) => <span key={c}>{person(c)}</span>)}</span> : <span className="muted">ninguno</span>,
          ],
        ]}
      />
      {kin.length > 0 && (
        <>
          <h4 className="section__title">Otros parientes</h4>
          <ul className="list list--dense">
            {kin.map((r) => (
              <li key={r.id}>
                {person(r.id)} <span className="muted num">parentesco {r.kinship.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
