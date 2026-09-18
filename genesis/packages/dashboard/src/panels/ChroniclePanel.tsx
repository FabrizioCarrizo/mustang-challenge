import type { ChronicleChapter, EventInfo, MilestoneInfo } from "@genesis/protocol";
import { useEffect, useMemo, useRef, useState } from "react";
import { EventText } from "../components/EventText.tsx";
import { AgentLink, Chip, Empty, ImportanceBadge, Loading, Section } from "../components/ui.tsx";
import { apiGet, useApi } from "../lib/api.ts";
import { formatTickLong, tickToDayTime } from "../lib/time.ts";
import { useUiStore } from "../store/uiStore.ts";
import { useWorldStore } from "../store/worldStore.ts";

const FEED_LIMIT = 150;
const CHRONICLE_REFRESH_MS = 30_000;
const CHRONICLE_EVENT = /cr[oó]nica/i;

export function ChroniclePanel() {
  const epoch = useWorldStore((s) => s.epoch);
  const milestones = useWorldStore((s) => s.milestones);
  const setMilestones = useWorldStore((s) => s.setMilestones);
  const mergeEvents = useWorldStore((s) => s.mergeEvents);
  const events = useWorldStore((s) => s.events);
  const tpd = useWorldStore((s) => s.world?.ticksPerDay ?? 144);
  const replayTick = useWorldStore((s) => s.replayTick);
  const panTo = useUiStore((s) => s.panTo);
  const [minImportance, setMinImportance] = useState(0);
  const chapters = useApi<ChronicleChapter[]>("/chronicle");
  const reloadChapters = chapters.reload;

  useEffect(() => {
    const ctrl = new AbortController();
    void apiGet<MilestoneInfo[]>("/milestones", ctrl.signal).then((r) => {
      if (r.status === "ok" && r.data.length && useWorldStore.getState().replayTick === null) setMilestones(r.data);
    });
    void apiGet<EventInfo[]>("/events/recent", ctrl.signal).then((r) => {
      if (r.status === "ok" && r.data.length) mergeEvents(r.data.slice().reverse());
    });
    return () => ctrl.abort();
  }, [setMilestones, mergeEvents]);

  // la crónica se reescribe cada 7 días: refresco periódico y cuando llega el evento del cronista
  useEffect(() => {
    const id = window.setInterval(reloadChapters, CHRONICLE_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [reloadChapters]);
  const lastSeenSeq = useRef(-1);
  useEffect(() => {
    if (lastSeenSeq.current < 0) {
      lastSeenSeq.current = events[0]?.seq ?? 0;
      return;
    }
    const fresh = events.filter((e) => e.seq > lastSeenSeq.current);
    if (events[0]) lastSeenSeq.current = Math.max(lastSeenSeq.current, events[0].seq);
    if (fresh.some((e) => e.kind === "create" && CHRONICLE_EVENT.test(e.text))) reloadChapters();
  }, [events, reloadChapters]);

  const sortedMilestones = useMemo(() => milestones.slice().sort((a, b) => b.tick - a.tick), [milestones]);
  const feed = useMemo(() => events.filter((e) => e.importance >= minImportance).slice(0, FEED_LIMIT), [events, minImportance]);
  const sortedChapters = useMemo(() => (chapters.data ?? []).slice().sort((a, b) => b.tickFrom - a.tickFrom), [chapters.data]);

  return (
    <div className="chronicle">
      <div className="epoch">
        <span className="muted">época</span>
        <strong className="epoch__name">{epoch || "sin nombre todavía"}</strong>
        {replayTick !== null && <span className="badge badge--accent">tal como era entonces</span>}
      </div>

      <Section title="Hitos">
        {sortedMilestones.length === 0 ? (
          <Empty>Todavía no hay hitos: el mundo recién empieza.</Empty>
        ) : (
          <ol className="list milestones" data-testid="milestones">
            {sortedMilestones.map((m) => (
              <li key={m.id} className="milestone">
                <div className="milestone__head">
                  <strong>{m.title}</strong>
                  <span className="muted num">{formatTickLong(m.tick, tpd)}</span>
                </div>
                {m.description && <div className="milestone__desc">{m.description}</div>}
                {(m.agentIds.length > 0 || m.epoch) && (
                  <div className="muted small milestone__meta">
                    {m.epoch && (
                      <span className="badge" title="época en la que ocurrió">
                        {m.epoch}
                      </span>
                    )}
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

      <Section
        title="Crónica"
        right={
          <button type="button" className="btn btn--xs btn--ghost" onClick={reloadChapters} title="volver a pedir la crónica">
            ↻
          </button>
        }
      >
        {chapters.status === "loading" && chapters.data === undefined && <Loading />}
        {chapters.status === "missing" && <Empty>Todavía no hay crónica escrita.</Empty>}
        {chapters.status === "error" && <Empty>No se pudo leer la crónica: {chapters.error}</Empty>}
        {chapters.status !== "loading" && chapters.status !== "missing" && chapters.status !== "error" && sortedChapters.length === 0 && (
          <Empty>El historiador todavía no escribió ningún capítulo: escribe uno cada 7 días.</Empty>
        )}
        {sortedChapters.length > 0 && (
          <div className="chapters" data-testid="chapters">
            {sortedChapters.map((c) => (
              <article key={c.id} className="chapter">
                <h4 className="chapter__title">{c.title}</h4>
                <div className="chapter__period muted num">
                  día {tickToDayTime(c.tickFrom, tpd).day} → día {tickToDayTime(c.tickTo, tpd).day}
                  {c.kind !== "historia" && <span className="badge">{c.kind}</span>}
                </div>
                <div className="chapter__body prose">
                  {c.body
                    .split(/\n\s*\n/)
                    .filter((p) => p.trim())
                    .map((p, i) => (
                      <p key={i}>{p.trim()}</p>
                    ))}
                </div>
                {(c.themes.length > 0 || c.protagonists.length > 0) && (
                  <div className="chips chips--muted">
                    {c.themes.map((t) => (
                      <Chip key={`t-${t}`}>{t}</Chip>
                    ))}
                    {c.protagonists.map((p) => (
                      <Chip key={`p-${p}`} color="var(--accent)">
                        {p}
                      </Chip>
                    ))}
                  </div>
                )}
              </article>
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
