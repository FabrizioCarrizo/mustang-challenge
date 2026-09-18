import type { EventInfo } from "@genesis/protocol";
import type { ReactNode } from "react";
import { useUiStore } from "../store/uiStore.ts";
import { useWorldStore } from "../store/worldStore.ts";

/**
 * Texto de un evento con los nombres de los seres involucrados como enlaces
 * (seleccionan al ser). Si el nombre no aparece en el texto, se agrega al final.
 */
export function EventText({ event }: { event: EventInfo }) {
  const select = useUiStore((s) => s.select);
  // los nombres se resuelven al renderizar; no nos suscribimos a cada delta
  const agents = useWorldStore.getState().agents;

  const links: Array<{ id: number; name: string }> = [];
  for (const id of [event.agentId, event.targetId]) {
    if (id === null) continue;
    const name = agents.get(id)?.name;
    if (name && !links.some((l) => l.id === id)) links.push({ id, name });
  }

  let rest = event.text;
  const parts: ReactNode[] = [];
  const pending = links.slice();
  let guard = 0;
  while (rest.length && pending.length && guard++ < 8) {
    let bestIdx = -1;
    let best: { id: number; name: string } | null = null;
    for (const l of pending) {
      const idx = rest.indexOf(l.name);
      if (idx >= 0 && (bestIdx < 0 || idx < bestIdx)) {
        bestIdx = idx;
        best = l;
      }
    }
    if (!best) break;
    const b = best;
    if (bestIdx > 0) parts.push(rest.slice(0, bestIdx));
    parts.push(
      <button
        type="button"
        className="link"
        key={`${b.id}-${parts.length}`}
        onClick={(e) => {
          e.stopPropagation();
          select(b.id);
        }}
      >
        {b.name}
      </button>,
    );
    rest = rest.slice(bestIdx + b.name.length);
    pending.splice(pending.indexOf(b), 1);
  }
  if (rest) parts.push(rest);
  const missing = links.filter((l) => !event.text.includes(l.name));
  return (
    <span className="event-text">
      {parts}
      {missing.length > 0 && (
        <span className="event-text__extra">
          {" "}
          {missing.map((m) => (
            <button
              type="button"
              className="link"
              key={m.id}
              onClick={(e) => {
                e.stopPropagation();
                select(m.id);
              }}
            >
              {m.name}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}
