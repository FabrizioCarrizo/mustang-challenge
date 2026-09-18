import type { MemoryInfo } from "@genesis/protocol";
import { useMemo, useState } from "react";
import { Empty, ImportanceBadge, Loading } from "../../components/ui.tsx";
import { useApi } from "../../lib/api.ts";
import { memoryKindLabel } from "../../lib/labels.ts";
import { formatTickLong } from "../../lib/time.ts";
import { useWorldStore } from "../../store/worldStore.ts";

export function MindTab({ id }: { id: number }) {
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState("");
  const tpd = useWorldStore((s) => s.world?.ticksPerDay ?? 144);
  const path = `/agents/${id}/memories?limit=60${applied ? `&q=${encodeURIComponent(applied)}` : ""}`;
  const res = useApi<MemoryInfo[]>(path);
  const list = useMemo(() => (res.data ?? []).slice().sort((a, b) => b.tick - a.tick || b.id - a.id), [res.data]);

  return (
    <div className="mind">
      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(q.trim());
        }}
      >
        <input className="input" placeholder="buscar en la memoria…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="buscar memorias" />
        <button type="submit" className="btn btn--sm">
          buscar
        </button>
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          onClick={() => {
            if (applied) {
              setQ("");
              setApplied("");
            } else res.reload();
          }}
          title={applied ? "quitar el filtro" : "volver a pedir"}
        >
          {applied ? "limpiar" : "actualizar"}
        </button>
      </form>
      {res.status === "loading" && !res.data && <Loading />}
      {res.status === "error" && <Empty>No se pudo leer la memoria: {res.error}</Empty>}
      {res.status === "missing" && <Empty>Este ser no tiene memoria accesible.</Empty>}
      {res.data && list.length === 0 && <Empty>{applied ? `Nada recuerda sobre “${applied}”.` : "Todavía no recuerda nada."}</Empty>}
      <ul className={`list mem${res.status === "loading" ? " list--stale" : ""}`}>
        {list.map((m) => (
          <li key={m.id} className="mem__item">
            <div className="mem__head">
              <ImportanceBadge value={m.importance} />
              <span className="mem__kind">{memoryKindLabel(m.kind)}</span>
              <span className="muted num">{formatTickLong(m.tick, tpd)}</span>
            </div>
            <div className="mem__text">{m.text}</div>
            {m.tags.length > 0 && <div className="mem__tags muted">{m.tags.join(" · ")}</div>}
          </li>
        ))}
      </ul>
    </div>
  );
}
