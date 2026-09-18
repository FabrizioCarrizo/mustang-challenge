import type { SnapshotListItem } from "@genesis/protocol";
import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { apiGet } from "../lib/api.ts";
import { formatHour, tickToDayTime } from "../lib/time.ts";
import { useWorldStore } from "../store/worldStore.ts";

function useReplayState() {
  return useWorldStore(
    useShallow((s) => ({
      ready: s.ready,
      liveTick: s.liveTick,
      replayTick: s.replayTick,
      replayPending: s.replayPending,
      tpd: s.world?.ticksPerDay ?? 144,
      snapshots: s.snapshots,
    })),
  );
}

/** Barra de tiempo bajo el mapa: viaja a cualquier snapshot diario del pasado. */
export function ReplayBar() {
  const { ready, liveTick, replayTick, replayPending, tpd, snapshots } = useReplayState();
  const requestReplay = useWorldStore((s) => s.requestReplay);
  const setSnapshots = useWorldStore((s) => s.setSnapshots);
  const [drag, setDrag] = useState<number | null>(null);

  // la lista de snapshots cambia una vez por día simulado
  const liveDay = Math.floor(liveTick / tpd);
  useEffect(() => {
    if (!ready) return;
    const ctrl = new AbortController();
    void apiGet<SnapshotListItem[]>("/snapshots", ctrl.signal).then((r) => {
      if (r.status === "ok") setSnapshots(r.data);
    });
    return () => ctrl.abort();
  }, [ready, liveDay, setSnapshots]);

  const replaying = replayTick !== null || replayPending !== null;
  const current = replayPending ?? replayTick ?? liveTick;
  const shown = drag ?? current;
  const min = snapshots.length ? snapshots[0]!.tick : 0;
  const max = Math.max(min + 1, liveTick);
  const marks = snapshots.filter((s) => s.tick <= max);
  const dayOf = (tick: number) => tickToDayTime(tick, tpd).day;
  const shownTime = tickToDayTime(shown, tpd);

  const goPrev = () => {
    const before = marks.filter((s) => s.tick < current);
    if (before.length) requestReplay(before[before.length - 1]!.tick);
  };
  const goNext = () => {
    const after = marks.filter((s) => s.tick > current);
    if (after.length && after[0]!.tick < liveTick) requestReplay(after[0]!.tick);
    else requestReplay(null);
  };
  const commit = () => {
    if (drag === null) return;
    const v = drag;
    setDrag(null);
    if (v >= max - 1) requestReplay(null);
    else requestReplay(v);
  };

  if (!ready) return null;
  return (
    <div className={`replay${replaying ? " replay--past" : ""}`} data-testid="replay-bar">
      <span className="replay__title muted">tiempo</span>
      <button type="button" className="btn btn--sm" onClick={goPrev} disabled={!marks.some((s) => s.tick < current)} title="un snapshot atrás" data-testid="replay-prev">
        ⏮
      </button>
      <div className="replay__track">
        <input
          type="range"
          className="replay__slider"
          min={min}
          max={max}
          step={1}
          value={shown}
          onChange={(e) => setDrag(Number(e.target.value))}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
          aria-label="momento de la historia"
          aria-valuetext={`día ${shownTime.day} ${formatHour(shownTime.hour)}`}
          data-testid="replay-slider"
        />
        <div className="replay__marks" aria-hidden>
          {marks.map((s) => (
            <span
              key={s.tick}
              className={`replay__mark${s.tick === replayTick ? " replay__mark--active" : ""}`}
              style={{ left: `${((s.tick - min) / (max - min)) * 100}%` }}
              title={`día ${dayOf(s.tick)} · ${s.agents} seres`}
            />
          ))}
        </div>
        <div className="replay__days muted">
          <span>día {dayOf(min)}</span>
          <span>{marks.length} snapshots</span>
          <span>día {dayOf(max)}</span>
        </div>
      </div>
      <button type="button" className="btn btn--sm" onClick={goNext} disabled={!replaying} title="un snapshot adelante" data-testid="replay-next">
        ⏭
      </button>
      <span className={`replay__now num${replaying ? " replay__now--past" : ""}`} data-testid="replay-time">
        día {shownTime.day} · {formatHour(shownTime.hour)}
      </span>
      <button type="button" className={`btn btn--sm${replaying ? " btn--active" : ""}`} onClick={() => requestReplay(null)} disabled={!replaying} data-testid="replay-live">
        volver al presente
      </button>
    </div>
  );
}

/** Cartel sobre el mapa mientras se mira el pasado. */
export function ReplayBanner() {
  const { liveTick, replayTick, replayPending, tpd } = useReplayState();
  const requestReplay = useWorldStore((s) => s.requestReplay);
  if (replayTick === null && replayPending === null) return null;
  const pending = replayPending !== null && replayPending !== replayTick;
  const target = replayPending ?? replayTick ?? 0;
  const day = tickToDayTime(target, tpd).day;
  const liveDay = tickToDayTime(liveTick, tpd).day;
  return (
    <div className={`replay-banner${pending ? " replay-banner--pending" : ""}`} data-testid="replay-banner" role="status">
      <strong>{pending ? `Reconstruyendo el día ${day}…` : `Viendo el pasado: día ${day}`}</strong>
      <span className="replay-banner__sub"> — el presente sigue corriendo (día {liveDay})</span>
      <button type="button" className="btn btn--sm" onClick={() => requestReplay(null)}>
        volver al presente
      </button>
    </div>
  );
}
