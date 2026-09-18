import { formatTickLong } from "../lib/time.ts";
import { useUiStore } from "../store/uiStore.ts";
import { useWorldStore } from "../store/worldStore.ts";

function wallTime(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

/** Los últimos avisos del servidor (compartido por la campana y la pestaña Dios). */
export function NoticeList({ limit }: { limit?: number }) {
  const notices = useUiStore((s) => s.notices);
  const tpd = useWorldStore((s) => s.world?.ticksPerDay ?? 144);
  const list = limit ? notices.slice(0, limit) : notices;
  if (list.length === 0) return <div className="empty">Sin avisos todavía.</div>;
  return (
    <ul className="list notice-list">
      {list.map((n) => (
        <li key={n.id} className={`notice notice--${n.level}`}>
          <span className="notice__time muted num" title={`hora real ${wallTime(n.at)}`}>
            {formatTickLong(n.tick, tpd)}
          </span>
          <span className="notice__text">{n.text}</span>
        </li>
      ))}
    </ul>
  );
}
