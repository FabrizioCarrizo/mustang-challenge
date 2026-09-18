import type { ChronicleChapter, EventInfo, MilestoneInfo } from "@genesis/protocol";
import { useEffect, useMemo, useState } from "react";
import { EventText } from "../components/EventText.tsx";
import { AgentLink, Empty, ImportanceBadge, Loading, Section } from "../components/ui.tsx";
import { apiGet, useApi } from "../lib/api.ts";
import { formatTickLong } from "../lib/time.ts";
import { useUiStore } from "../store/uiStore.ts";
import { useWorldStore } from "../store/worldStore.ts";

const FEED_LIMIT = 150;

export function ChroniclePanel() {
  const epoch = useWorldStore((s) => s.epoch);
  const milestones = useWorldStore((s) => s.milestones);
  const setMilestones = useWorldStore((s) => s.setMilestones);
  const mergeEvents = useWorldStore((s) => s.mergeEvents);
  const events = useWorldStore((s) => s.events);
  const tpd = useWorldStore((s) => s.world?.ticksPerDay ?? 144);
  const panTo = useUiStore((s) => s.panTo);
  const [minImportance, setMinImportance] = useState(0);
  const chapters = useApi<ChronicleChapter[]>("/chronicle");

  useEffect(() => {
    const ctrl = new AbortController();
    void apiGet<MilestoneInfo[]>("/milestones", ctrl.signal).then((r) => {
      if (r.status === "ok" && r.data.length) setMilestones(r.data);
    });
    void apiGet<EventInfo[]>("/events/recent", ctrl.signal).then((r) => {
      if (r.status === "ok" && r.data.length) mergeEvents(r.data.slice().reverse());
    });
    return () => ctrl.abort();
  }, [setMilestones, mergeEvents]);

  const sortedMilestones = useMemo(() => milestones.slice().sort((a, b) => b.tick - a.tick), [milestones]);
  const feed = useMemo(() => events.filter((e) => e.importance >= minImportance).slice(0, FEED_LIMIT), [events, minImportance]);

  return (
    <div className="chronicle">
      <div className="epoch">
        <span className="muted">época</span>
        <strong className="epoch__name">{epoch || "sin nombre todavía"}</strong>
      </div>

      <Section title="Hitos">
        {sortedMilestones.length === 0 ? (
          <Empty>Todavía no hay hitos: el mundo recién empieza.</Empty>
        ) : (
          <ol className="list milestones">
            {sortedMilestones.map((m) => (
              <li key={m.id} className="milestone">
                <div className="milestone__head">
                  <strong>{m.title}</strong>
                  <span className="muted num">{formatTickLong(m.tick, tpd)}</span>
                </div>
                {m.description && <div className="milestone__desc">{m.description}</div>}
                {(m.agentIds.length > 0 || m.epoch) && (
                  <div className="muted small">
                    {m.epoch && <span className="badge">{m.epoch}</span>}{" "}
                    {m.agentIds.map((id) => (
                      <AgentLink key={id} id={id} />
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section title="Capítulos">
        {chapters.status === "loading" && chapters.data === undefined && <Loading />}
        {chapters.status === "missing" && <Empty>Todavía no hay crónica escrita: el cronista llega en una fase posterior.</Empty>}
        {chapters.status === "error" && <Empty>No se pudo leer la crónica: {chapters.error}</Empty>}
        {chapters.status === "ok" && chapters.data.length === 0 && <Empty>Todavía no hay capítulos.</Empty>}
        {chapters.status === "ok" && chapters.data.length > 0 && (
          <div className="chapters">
            {chapters.data
              .slice()
              .sort((a, b) => b.tickFrom - a.tickFrom)
              .map((c) => (
                <details key={c.id} className="fold chapter">
                  <summary>
                    <strong>{c.title}</strong>{" "}
                    <span className="muted small num">
                      {formatTickLong(c.tickFrom, tpd)} → {formatTickLong(c.tickTo, tpd)}
                    </span>
                  </summary>
                  <p className="prose">{c.body}</p>
                  {c.themes.length > 0 && <div className="muted small">temas: {c.themes.join(", ")}</div>}
                  {c.protagonists.length > 0 && <div className="muted small">protagonistas: {c.protagonists.join(", ")}</div>}
                </details>
              ))}
          </div>
        )}
      </Section>

      <Section
        title="Sucesos"
        right={
          <div className="segmented" role="group" aria-label="importancia mínima">
            {[
              [0, "todos"],
              [6, "≥ 6"],
              [8, "≥ 8"],
            ].map(([v, label]) => (
              <button key={String(v)} type="button" className={`btn btn--xs btn--seg${minImportance === v ? " btn--active" : ""}`} onClick={() => setMinImportance(Number(v))}>
                {label}
              </button>
            ))}
          </div>
        }
      >
        {feed.length === 0 ? (
          <Empty>Todavía no pasó nada digno de contarse.</Empty>
        ) : (
          <ul className="list feed" data-testid="event-feed">
            {feed.map((ev) => (
              <li
                key={ev.seq}
                className={`feed__item${ev.x !== null ? " feed__item--place" : ""}`}
                onClick={() => {
                  if (ev.x !== null && ev.y !== null) panTo(ev.x, ev.y);
                }}
                title={ev.x !== null ? `${ev.kind} · ir a ${ev.x}, ${ev.y}` : ev.kind}
              >
                <ImportanceBadge value={ev.importance} />
                <span className="muted num feed__time">{formatTickLong(ev.tick, tpd)}</span>
                <EventText event={ev} />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
