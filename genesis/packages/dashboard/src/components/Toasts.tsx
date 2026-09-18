import { useUiStore } from "../store/uiStore.ts";

export function Toasts() {
  const toasts = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismissToast);
  if (toasts.length === 0) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast--${t.level}`} onClick={() => dismiss(t.id)} data-testid="toast">
          <span className="toast__level">{t.level === "info" ? "aviso" : t.level === "warn" ? "atención" : "error"}</span>
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}
