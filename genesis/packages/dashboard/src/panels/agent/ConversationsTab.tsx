import type { ConversationInfo } from "@genesis/protocol";
import { AgentLink, Empty, Loading } from "../../components/ui.tsx";
import { useApi } from "../../lib/api.ts";
import { formatTickLong } from "../../lib/time.ts";
import { useWorldStore } from "../../store/worldStore.ts";

export function ConversationsTab({ id }: { id: number }) {
  const res = useApi<ConversationInfo[]>(`/agents/${id}/conversations`);
  const tpd = useWorldStore((s) => s.world?.ticksPerDay ?? 144);
  if (res.status === "loading" && !res.data) return <Loading />;
  if (res.status === "missing") return <Empty>Todavía no hay conversaciones registradas: llegan con el cerebro de la fase 2.</Empty>;
  if (res.status === "error") return <Empty>No se pudieron leer las conversaciones: {res.error}</Empty>;
  const list = (res.data ?? []).slice().sort((a, b) => b.tick - a.tick);
  if (list.length === 0) return <Empty>Todavía no conversó con nadie.</Empty>;
  return (
    <ul className="list convs">
      {list.map((c) => (
        <li key={c.id} className="conv">
          <div className="conv__head">
            <AgentLink id={c.aId} name={c.aName} /> <span className="muted">y</span> <AgentLink id={c.bId} name={c.bName} />
            <span className="muted num">{formatTickLong(c.tick, tpd)}</span>
          </div>
          <div className="conv__turns">
            {c.turns.map((t, i) => (
              <div key={i} className={`turn turn--${t.speaker === "A" ? "a" : "b"}`}>
                <span className="turn__who">{t.speaker === "A" ? c.aName : c.bName}</span>
                <span className="turn__text">{t.text}</span>
              </div>
            ))}
          </div>
          {c.outcomes.length > 0 && (
            <div className="chips chips--muted">
              {c.outcomes.map((o, i) => (
                <span key={i} className="chip" title={o.detalle}>
                  {o.tipo}: {o.detalle}
                </span>
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
