import type { LlmCallInfo } from "@genesis/protocol";
import { Empty, JsonBlock, Loading } from "../../components/ui.tsx";
import { useApi } from "../../lib/api.ts";
import { fmtCompact, fmtUsd } from "../../lib/format.ts";
import { formatTickLong } from "../../lib/time.ts";
import { useWorldStore } from "../../store/worldStore.ts";

export function ThoughtsTab({ id }: { id: number }) {
  const res = useApi<LlmCallInfo[]>(`/agents/${id}/llm-calls`);
  const tpd = useWorldStore((s) => s.world?.ticksPerDay ?? 144);
  const mode = useWorldStore((s) => s.budget?.mode ?? "none");
  if (res.status === "loading" && !res.data) return <Loading />;
  if (res.status === "missing") return <Empty>Los pensamientos del modelo llegan en la fase 2.</Empty>;
  if (res.status === "error") return <Empty>No se pudieron leer los pensamientos: {res.error}</Empty>;
  const list = (res.data ?? []).slice().sort((a, b) => b.tick - a.tick);
  if (list.length === 0) {
    return (
      <div>
        <Empty>Todavía no pensó con el modelo{mode === "none" ? " (el cerebro está apagado)" : mode === "mock" ? " (cerebro simulado)" : ""}.</Empty>
        <div className="toolbar">
          <button type="button" className="btn btn--sm btn--ghost" onClick={res.reload}>
            actualizar
          </button>
        </div>
      </div>
    );
  }
  return (
    <div>
      <div className="toolbar">
        <span className="muted">
          {list.length} llamadas · {fmtUsd(list.reduce((s, c) => s + c.usd, 0), 4)}
        </span>
        <button type="button" className="btn btn--sm btn--ghost" onClick={res.reload}>
          actualizar
        </button>
      </div>
      <ul className="list thoughts">
        {list.map((c) => (
          <li key={c.id} className="thought">
            <div className="thought__head">
              <span className="badge">{c.callType}</span>
              <span className={`badge badge--${c.status === "ok" ? "good" : "warn"}`}>{c.status}</span>
              <span className="muted">{c.model}</span>
              <span className="muted num">{formatTickLong(c.tick, tpd)}</span>
            </div>
            <div className="thought__stats muted num">
              {fmtCompact(c.inTokens)} in · {fmtCompact(c.cacheRead)} caché · {fmtCompact(c.outTokens)} out · {fmtUsd(c.usd, 4)} · {c.latencyMs} ms
            </div>
            {c.volatileText && <p className="prose">{c.volatileText}</p>}
            <JsonBlock text={c.responseJson} summary="respuesta del modelo" />
          </li>
        ))}
      </ul>
    </div>
  );
}
