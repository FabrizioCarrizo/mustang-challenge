import { importanceClass } from "../lib/colors.ts";
import { formatTickLong } from "../lib/time.ts";
import { useUiStore } from "../store/uiStore.ts";
import { useWorldStore } from "../store/worldStore.ts";
import { EventText } from "./EventText.tsx";

const TICKER_SIZE = 6;

export function Ticker() {
  const events = useWorldStore((s) => s.events);
  const tpd = useWorldStore((s) => s.world?.ticksPerDay ?? 144);
  const select = useUiStore((s) => s.select);
  const panTo = useUiStore((s) => s.panTo);
  const recent = events.slice(0, TICKER_SIZE);
  if (recent.length === 0) return null;
  return (
    <div className="ticker" data-testid="ticker">
      {recent.map((ev, i) => {
        const go = () => {
          if (ev.agentId !== null) select(ev.agentId);
          if (ev.x !== null && ev.y !== null) panTo(ev.x, ev.y);
        };
        // div con rol de botón: el texto trae sus propios botones (nombres) y no pueden anidarse
        return (
          <div
            key={ev.seq}
            role="button"
            tabIndex={0}
            className="ticker__item"
            style={{ opacity: 1 - i * 0.11 }}
            onClick={go}
            onKeyDown={(e) => {
              if (e.key === "Enter") go();
            }}
            title={`${ev.kind} · ${formatTickLong(ev.tick, tpd)}`}
          >
            <span className={importanceClass(ev.importance)}>{ev.importance}</span>
            <span className="ticker__time num">{formatTickLong(ev.tick, tpd)}</span>
            <EventText event={ev} />
          </div>
        );
      })}
    </div>
  );
}
