import type { ReactNode } from "react";
import { importanceClass } from "../lib/colors.ts";
import { useUiStore } from "../store/uiStore.ts";
import { agentName } from "../store/worldStore.ts";

export function Bar({ value, color, label, right, thin }: { value: number; color?: string; label?: ReactNode; right?: ReactNode; thin?: boolean }) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) * 100;
  return (
    <div className={`bar${thin ? " bar--thin" : ""}`}>
      {label !== undefined && <span className="bar__label">{label}</span>}
      <span className="bar__track">
        <span className="bar__fill" style={{ width: `${pct}%`, background: color ?? "var(--accent-2)" }} />
      </span>
      {right !== undefined && <span className="bar__value num">{right}</span>}
    </div>
  );
}

export function Chip({ children, color, title }: { children: ReactNode; color?: string; title?: string }) {
  return (
    <span className="chip" title={title}>
      {color && <span className="swatch" style={{ background: color }} />}
      {children}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Loading({ children = "cargando…" }: { children?: ReactNode }) {
  return <div className="empty empty--loading">{children}</div>;
}

export function Section({ title, children, right, id }: { title: ReactNode; children: ReactNode; right?: ReactNode; id?: string }) {
  return (
    <section className="section" id={id}>
      <header className="section__head">
        <h3 className="section__title">{title}</h3>
        {right !== undefined && <div className="section__right">{right}</div>}
      </header>
      {children}
    </section>
  );
}

export function KeyValue({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="kv">
      {items.map(([k, v]) => (
        <div className="kv__row" key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ImportanceBadge({ value }: { value: number }) {
  return (
    <span className={importanceClass(value)} title={`importancia ${value}`}>
      {value}
    </span>
  );
}

/** Nombre de un ser: al hacer clic lo selecciona. */
export function AgentLink({ id, name, className }: { id: number | null; name?: string; className?: string }) {
  const select = useUiStore((s) => s.select);
  if (id === null) return <span className={className}>{name ?? "—"}</span>;
  const label = name ?? agentName(id);
  return (
    <button type="button" className={`link${className ? ` ${className}` : ""}`} onClick={() => select(id)} title={`ver a ${label}`}>
      {label}
    </button>
  );
}

/** JSON con sangría dentro de un bloque plegable. */
export function JsonBlock({ text, summary = "respuesta" }: { text: string | null; summary?: string }) {
  if (!text) return null;
  let pretty = text;
  try {
    pretty = JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    // texto plano
  }
  return (
    <details className="json">
      <summary>{summary}</summary>
      <pre>{pretty}</pre>
    </details>
  );
}

/** Render genérico de una estructura desconocida (rutas de fases futuras). */
export function GenericValue({ value, depth = 0 }: { value: unknown; depth?: number }): ReactNode {
  if (value === null || value === undefined) return <span className="muted">—</span>;
  if (typeof value === "number") return <span className="num">{Number.isInteger(value) ? value : value.toFixed(2)}</span>;
  if (typeof value === "boolean") return <span>{value ? "sí" : "no"}</span>;
  if (typeof value === "string") return <span>{value}</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="muted">ninguno</span>;
    if (value.every((v) => typeof v !== "object")) return <span>{value.map(String).join(", ")}</span>;
    return (
      <div className="generic-list">
        {value.slice(0, 50).map((v, i) => (
          <div className="generic-item" key={i}>
            <GenericValue value={v} depth={depth + 1} />
          </div>
        ))}
      </div>
    );
  }
  if (depth > 3) return <span className="muted">…</span>;
  const entries = Object.entries(value as Record<string, unknown>);
  return (
    <dl className="kv kv--compact">
      {entries.map(([k, v]) => (
        <div className="kv__row" key={k}>
          <dt>{k}</dt>
          <dd>
            <GenericValue value={v} depth={depth + 1} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
