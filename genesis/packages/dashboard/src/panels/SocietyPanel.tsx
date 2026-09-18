import type { BeliefInfo, EconomyInfo, GroupInfo, LawInfo, TechInfo, TextInfo } from "@genesis/protocol";
import { type ReactNode, useEffect, useState } from "react";
import { AgentLink, Chip, Empty, KeyValue, Loading, Section } from "../components/ui.tsx";
import { type ApiResult, useApi } from "../lib/api.ts";
import { fmtNum } from "../lib/format.ts";
import { formatTickLong } from "../lib/time.ts";
import { useUiStore } from "../store/uiStore.ts";
import { agentName, useWorldStore } from "../store/worldStore.ts";

const REFRESH_MS = 30_000;

/** /api/society/leaders */
interface LeaderInfo {
  groupId: number;
  groupName: string;
  leaderId: number | null;
  leaderName: string;
  members: number;
}

/** /api/society/crimes */
interface CrimeInfo {
  id: number;
  tick: number;
  criminalId: number;
  criminalName: string;
  victimId: number | null;
  victimName: string | null;
  verb: string;
  punished: boolean;
  lawId: number | null;
  groupId: number | null;
}

const MEDIUM_LABELS: Record<string, string> = { oral: "oral", tallado: "tallado", escrito: "escrito", objeto: "objeto" };

export function SocietyPanel() {
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setNonce((n) => n + 1), REFRESH_MS);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div className="society" key={nonce}>
      <div className="toolbar toolbar--right">
        <span className="muted small">se actualiza cada 30 s</span>
        <button type="button" className="btn btn--sm btn--ghost" onClick={() => setNonce((n) => n + 1)}>
          actualizar todo
        </button>
      </div>
      <GroupsSection />
      <RemoteSection<LeaderInfo[]> path="/society/leaders" title="Líderes" empty="Todavía no hay líderes: nadie se impuso ni fue elegido." render={(list) => <Leaders list={list} />} />
      <RemoteSection<EconomyInfo> path="/society/economy" title="Economía" empty="Todavía no hay economía: solo trueque disperso." render={(e) => <Economy e={e} />} />
      <RemoteSection<BeliefInfo[]> path="/society/beliefs" title="Creencias" empty="Todavía no hay creencias compartidas." render={(list) => <Beliefs list={list} />} />
      <RemoteSection<TechInfo[]> path="/society/tech" title="Tecnología" empty="Todavía no descubrieron ninguna técnica." render={(list) => <Techs list={list} />} />
      <RemoteSection<TextInfo[]> path="/society/texts?limit=60" title="Textos" empty="Todavía nadie escribió nada." render={(list) => <Texts list={list} />} />
      <RemoteSection<LawInfo[]> path="/society/laws" title="Leyes" empty="Todavía no hay leyes declaradas." render={(list) => <Laws list={list} />} />
      <RemoteSection<CrimeInfo[]> path="/society/crimes" title="Crímenes" empty="Nadie rompió una ley todavía." render={(list) => <Crimes list={list} />} />
    </div>
  );
}

function stateOf<T>(res: ApiResult<T>, empty: string): { node: ReactNode } | null {
  if (res.status === "loading" && res.data === undefined) return { node: <Loading /> };
  if (res.status === "missing") return { node: <Empty>{empty}</Empty> };
  if (res.status === "error") return { node: <Empty>No se pudo leer: {res.error}</Empty> };
  const data = res.data;
  if (data === undefined || data === null) return { node: <Empty>{empty}</Empty> };
  if (Array.isArray(data) && data.length === 0) return { node: <Empty>{empty}</Empty> };
  return null;
}

/** Sección que lee una ruta de /api/society/* y degrada con calma si no existe o está vacía. */
function RemoteSection<T>({ path, title, empty, render }: { path: string; title: string; empty: string; render: (data: T) => ReactNode }) {
  const res = useApi<T>(path);
  const s = stateOf(res, empty);
  return (
    <Section
      title={title}
      right={
        <button type="button" className="btn btn--xs btn--ghost" onClick={res.reload} title="volver a pedir">
          ↻
        </button>
      }
    >
      {s ? s.node : render(res.data as T)}
    </Section>
  );
}

function GroupsSection() {
  const groups = useWorldStore((s) => s.groups);
  const res = useApi<GroupInfo[]>(groups.length ? null : "/society/groups");
  const list = groups.length ? groups : res.status === "ok" ? res.data : [];
  const panTo = useUiStore((s) => s.panTo);
  const tpd = useWorldStore((s) => s.world?.ticksPerDay ?? 144);
  const agentsVersion = useWorldStore((s) => s.agentsVersion);
  void agentsVersion;
  let body: ReactNode;
  if (list.length === 0) {
    body = res.status === "loading" && !groups.length && res.data === undefined ? <Loading /> : <Empty>Todavía no hay tribus: cada ser anda por su cuenta.</Empty>;
  } else {
    body = (
      <ul className="list groups" data-testid="groups">
        {list.map((g) => (
          <li key={g.id} className="group" style={{ borderLeftColor: g.color }}>
            <div className="group__head">
              <span className="swatch swatch--lg" style={{ background: g.color }} />
              <strong>{g.name}</strong>
              <span className="muted num">{g.members.length} miembros</span>
              {g.home && (
                <button type="button" className="link" onClick={() => panTo(g.home!.x, g.home!.y)}>
                  hogar {g.home.x}, {g.home.y}
                </button>
              )}
            </div>
            <div className="muted small">
              líder: {g.leaderId !== null ? <AgentLink id={g.leaderId} /> : "ninguno"} · fundada {formatTickLong(g.foundedTick, tpd)}
            </div>
            <div className="chips chips--muted">
              {g.members.slice(0, 16).map((m) => (
                <AgentLink key={m} id={m} name={agentName(m)} className="chip" />
              ))}
              {g.members.length > 16 && <span className="chip">+{g.members.length - 16}</span>}
            </div>
          </li>
        ))}
      </ul>
    );
  }
  return <Section title="Tribus">{body}</Section>;
}

function Leaders({ list }: { list: LeaderInfo[] }) {
  const colors = useWorldStore((s) => s.groupColors);
  return (
    <ul className="list list--dense">
      {list.map((l) => (
        <li key={l.groupId} className="leader">
          <span className="swatch" style={{ background: colors.get(l.groupId) ?? "var(--muted)" }} />
          <AgentLink id={l.leaderId} name={l.leaderName} /> <span className="muted">lidera</span> <strong>{l.groupName}</strong>{" "}
          <span className="muted num">({l.members} miembros)</span>
        </li>
      ))}
    </ul>
  );
}

function Economy({ e }: { e: EconomyInfo }) {
  const tpd = useWorldStore((s) => s.world?.ticksPerDay ?? 144);
  return (
    <div>
      <KeyValue
        items={[
          ["moneda", e.currency ? `${e.currency}${e.currencySinceTick !== null ? ` (desde ${formatTickLong(e.currencySinceTick, tpd)})` : ""}` : "ninguna todavía"],
          ["índice de precios", fmtNum(e.cpi, 2)],
          ["gini", fmtNum(e.gini, 3)],
          ["trueques (7 días)", fmtNum(e.tradesLast7Days)],
          ["regalos (7 días)", fmtNum(e.giftsLast7Days)],
        ]}
      />
      {e.prices.length > 0 && (
        <div className="chips">
          {e.prices.map((p) => (
            <Chip key={p.good}>
              {p.good} <span className="num">{fmtNum(p.price, 2)}</span>
            </Chip>
          ))}
        </div>
      )}
      {e.topHolders.length > 0 && (
        <>
          <h4 className="section__title">Los más ricos</h4>
          <ul className="list list--dense">
            {e.topHolders.map((h) => (
              <li key={h.id}>
                <AgentLink id={h.id} name={h.name} /> <span className="muted num">{fmtNum(h.wealth, 1)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Beliefs({ list }: { list: BeliefInfo[] }) {
  const tpd = useWorldStore((s) => s.world?.ticksPerDay ?? 144);
  const sorted = list.slice().sort((a, b) => Number(b.religion) - Number(a.religion) || b.adherents - a.adherents);
  return (
    <ul className="list">
      {sorted.map((b) => (
        <li key={b.id} className={`belief${b.religion ? " belief--religion" : ""}`}>
          <div>
            {b.religion && <span className="badge badge--accent">religión</span>} <span className="badge">{b.kind}</span> “{b.statement}”
          </div>
          <div className="muted small">
            {b.founderId !== null ? <AgentLink id={b.founderId} name={b.founderName ?? undefined} /> : "origen desconocido"} · {b.adherents} {b.adherents === 1 ? "fiel" : "fieles"} · {formatTickLong(b.tick, tpd)}
          </div>
        </li>
      ))}
    </ul>
  );
}

function Techs({ list }: { list: TechInfo[] }) {
  const tpd = useWorldStore((s) => s.world?.ticksPerDay ?? 144);
  const known = list.filter((t) => t.discoveredTick !== null).sort((a, b) => b.knownBy - a.knownBy);
  const pending = list.filter((t) => t.discoveredTick === null);
  return (
    <div>
      {known.length === 0 && <Empty>Todavía no descubrieron ninguna técnica.</Empty>}
      <ul className="list list--dense">
        {known.map((t) => (
          <li key={t.id}>
            <strong>{t.name}</strong> <span className="muted num">{t.knownBy} la conocen</span>
            {t.discovererId !== null && (
              <span className="muted small">
                {" "}
                · descubierta por <AgentLink id={t.discovererId} /> {t.discoveredTick !== null && formatTickLong(t.discoveredTick, tpd)}
              </span>
            )}
          </li>
        ))}
      </ul>
      {pending.length > 0 && (
        <details className="fold">
          <summary>{pending.length} por descubrir</summary>
          <div className="chips chips--muted">
            {pending.map((t) => (
              <Chip key={t.id} title={t.requires.length ? `requiere ${t.requires.join(", ")}` : undefined}>
                {t.name}
              </Chip>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function Texts({ list }: { list: TextInfo[] }) {
  const tpd = useWorldStore((s) => s.world?.ticksPerDay ?? 144);
  const sorted = list.slice().sort((a, b) => b.tick - a.tick);
  return (
    <ul className="list">
      {sorted.map((t) => (
        <li key={t.id} className="text">
          <details className="fold">
            <summary>
              <strong>{t.title}</strong>{" "}
              <span className="muted small">
                {t.kind} · {MEDIUM_LABELS[t.medium] ?? t.medium} · <AgentLink id={t.authorId} name={t.authorName} /> · {t.reads} {t.reads === 1 ? "lectura" : "lecturas"} · {formatTickLong(t.tick, tpd)}
              </span>
            </summary>
            <p className="prose">{t.body}</p>
          </details>
        </li>
      ))}
    </ul>
  );
}

function Laws({ list }: { list: LawInfo[] }) {
  const tpd = useWorldStore((s) => s.world?.ticksPerDay ?? 144);
  const sorted = list.slice().sort((a, b) => Number(b.active) - Number(a.active) || b.tick - a.tick);
  return (
    <ul className="list">
      {sorted.map((l) => (
        <li key={l.id} className={`law${l.active ? "" : " law--inactive"}`}>
          <div>
            <span className="badge">{l.groupName}</span> “{l.statement}”
          </div>
          <div className="muted small">
            declarada por <AgentLink id={l.declarerId} name={l.declarerName} /> {formatTickLong(l.tick, tpd)} · castigo: {l.punishment} · {l.enforcements} {l.enforcements === 1 ? "aplicación" : "aplicaciones"}
            {l.active ? "" : " · derogada"}
          </div>
          {l.prohibits.length > 0 && <div className="muted small">prohíbe {l.prohibits.join(", ")}</div>}
        </li>
      ))}
    </ul>
  );
}

function Crimes({ list }: { list: CrimeInfo[] }) {
  const tpd = useWorldStore((s) => s.world?.ticksPerDay ?? 144);
  const sorted = list.slice().sort((a, b) => b.tick - a.tick).slice(0, 40);
  return (
    <ul className="list list--dense">
      {sorted.map((c) => (
        <li key={c.id} className="crime">
          <span className="muted num">{formatTickLong(c.tick, tpd)}</span> <AgentLink id={c.criminalId} name={c.criminalName} /> <span className="crime__verb">{c.verb.replace(/_/g, " ")}</span>
          {c.victimId !== null && (
            <>
              {" "}
              a <AgentLink id={c.victimId} name={c.victimName ?? undefined} />
            </>
          )}{" "}
          <span className={`badge ${c.punished ? "badge--good" : "badge--warn"}`}>{c.punished ? "castigado" : "impune"}</span>
        </li>
      ))}
    </ul>
  );
}
