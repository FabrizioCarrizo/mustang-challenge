import type { AgentDetail, Sex } from "@genesis/protocol";
import { useEffect, useMemo } from "react";
import { AgentLink, Empty, Loading } from "../../components/ui.tsx";
import { useApi } from "../../lib/api.ts";
import { formatTickLong } from "../../lib/time.ts";
import { useWorldStore } from "../../store/worldStore.ts";

/** /api/agents/:id/family */
interface FamilyNode {
  id: number;
  name: string;
  sex: Sex;
  alive: boolean;
  bornTick: number;
  diedTick: number | null;
}
interface FamilyInfo {
  self: FamilyNode | null;
  partner: FamilyNode | null;
  parents: Array<FamilyNode | null>;
  grandparents: Array<FamilyNode | null>;
  children: Array<FamilyNode | null>;
  grandchildren: Array<FamilyNode | null>;
  siblings: Array<FamilyNode | null>;
}

const PARTNER_RE = /pareja|espos|compañer|amante|vínculo|vinculo|casad|cónyuge|conyuge/i;

function present(list: Array<FamilyNode | null> | undefined): FamilyNode[] {
  const out: FamilyNode[] = [];
  const seen = new Set<number>();
  for (const n of list ?? []) {
    if (n && !seen.has(n.id)) {
      seen.add(n.id);
      out.push(n);
    }
  }
  return out;
}

function Person({ n, self }: { n: FamilyNode; self?: boolean }) {
  const tpd = useWorldStore((s) => s.world?.ticksPerDay ?? 144);
  const born = formatTickLong(n.bornTick, tpd);
  const title = `${n.sex === "f" ? "femenino" : "masculino"} · nació ${born}${n.diedTick !== null ? ` · murió ${formatTickLong(n.diedTick, tpd)}` : ""}`;
  return (
    <span className={`person-chip${self ? " person-chip--self" : ""}${n.alive ? "" : " person-chip--dead"}`} title={title}>
      <span className="person-chip__sex" aria-hidden>
        {n.sex === "f" ? "♀" : "♂"}
      </span>
      {self ? <strong>{n.name}</strong> : <AgentLink id={n.id} name={n.name} />}
      {!n.alive && <span className="person-chip__dead" title="muerto">†</span>}
    </span>
  );
}

function Generation({ label, people, self, partner, empty }: { label: string; people: FamilyNode[]; self?: FamilyNode | null; partner?: FamilyNode | null; empty?: string }) {
  const hasContent = people.length > 0 || self || partner;
  return (
    <div className={`tree__row${hasContent ? "" : " tree__row--empty"}`}>
      <span className="tree__label muted">{label}</span>
      <div className="tree__people">
        {self && <Person n={self} self />}
        {self && partner && <span className="tree__bond" title="pareja">
          ⟷
        </span>}
        {partner && <Person n={partner} />}
        {people.map((p) => (
          <Person key={p.id} n={p} />
        ))}
        {!hasContent && <span className="muted small">{empty ?? "—"}</span>}
      </div>
    </div>
  );
}

export function FamilyTab({ d }: { d: AgentDetail }) {
  const res = useApi<FamilyInfo>(`/agents/${d.id}/family`);
  const reload = res.reload;
  // los nacimientos cambian el árbol: refresco suave cada minuto
  useEffect(() => {
    const id = window.setInterval(reload, 60_000);
    return () => window.clearInterval(id);
  }, [reload]);

  const fam = res.status === "ok" ? res.data : res.data;
  const fallback = useMemo(() => buildFallback(d), [d]);

  if (res.status === "loading" && !fam) return <Loading />;
  const f = fam ?? fallback;
  const grandparents = present(f.grandparents);
  const parents = present(f.parents);
  const siblings = present(f.siblings);
  const children = present(f.children);
  const grandchildren = present(f.grandchildren);
  const self = f.self ?? fallback.self;
  const partner = f.partner;
  const empty = grandparents.length + parents.length + siblings.length + children.length + grandchildren.length === 0 && !partner;

  return (
    <div className="family" data-testid="family">
      {res.status === "missing" && <p className="muted small">El árbol completo llega con el servidor nuevo; se muestra lo que sabe el ser.</p>}
      {empty ? (
        <Empty>Sin familia conocida: {d.parents.every((p) => p === null) ? "nació con la primera generación y todavía no formó pareja." : "no tiene parientes vivos ni recordados."}</Empty>
      ) : (
        <div className="tree">
          <Generation label="abuelos" people={grandparents} empty="desconocidos" />
          <Generation label="padres" people={parents} empty="desconocidos" />
          <Generation label="yo · pareja" people={[]} self={self} partner={partner} />
          <Generation label="hijos" people={children} empty="ninguno" />
          <Generation label="nietos" people={grandchildren} empty="ninguno" />
          {siblings.length > 0 && <Generation label="hermanos" people={siblings} />}
        </div>
      )}
    </div>
  );
}

/** Sin la ruta /family: se arma lo que se puede con el detalle del ser y los seres del mapa. */
function buildFallback(d: AgentDetail): FamilyInfo {
  const agents = useWorldStore.getState().agents;
  const node = (id: number | null): FamilyNode | null => {
    if (id === null) return null;
    const a = agents.get(id);
    return a ? { id: a.id, name: a.name, sex: a.sex, alive: a.alive, bornTick: 0, diedTick: null } : { id, name: `#${id}`, sex: "m", alive: true, bornTick: 0, diedTick: null };
  };
  const partnerRel = d.relationships.find((r) => r.label && PARTNER_RE.test(r.label));
  return {
    self: { id: d.id, name: d.name, sex: d.sex, alive: d.alive, bornTick: d.bornTick, diedTick: d.diedTick },
    partner: partnerRel ? node(partnerRel.id) : null,
    parents: d.parents.map(node),
    grandparents: [],
    children: d.children.map(node),
    grandchildren: [],
    siblings: [],
  };
}
