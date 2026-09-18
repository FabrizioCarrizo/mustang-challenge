import { useCallback, useEffect, useRef, useState } from "react";

export type ApiResult<T> =
  | { status: "loading"; data?: T }
  | { status: "ok"; data: T }
  | { status: "missing"; data?: T }
  | { status: "error"; error: string; data?: T };

/** GET /api/... — 404/501 se reportan como "missing" (ruta de una fase futura). */
export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`/api${path}`, { signal, headers: { accept: "application/json" } });
    if (res.status === 404 || res.status === 501) return { status: "missing" };
    if (!res.ok) return { status: "error", error: `HTTP ${res.status}` };
    const data = (await res.json()) as T;
    return { status: "ok", data };
  } catch (err) {
    if ((err as Error).name === "AbortError") return { status: "loading" };
    return { status: "error", error: (err as Error).message };
  }
}

export async function apiPost<T>(path: string, body: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`/api${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 404 || res.status === 501) return { status: "missing" };
    if (!res.ok) return { status: "error", error: `HTTP ${res.status}` };
    return { status: "ok", data: (await res.json()) as T };
  } catch (err) {
    return { status: "error", error: (err as Error).message };
  }
}

/**
 * Hook de lectura: vuelve a pedir cuando cambia `path` o se llama `reload()`.
 * Mientras recarga conserva los datos anteriores (sin parpadeo).
 */
export function useApi<T>(path: string | null): ApiResult<T> & { reload: () => void } {
  const [state, setState] = useState<ApiResult<T>>({ status: "loading" });
  const [nonce, setNonce] = useState(0);
  const last = useRef<T | undefined>(undefined);

  useEffect(() => {
    if (!path) {
      setState({ status: "loading" });
      return;
    }
    const ctrl = new AbortController();
    setState((s) => ({ status: "loading", data: s.data }));
    void apiGet<T>(path, ctrl.signal).then((r) => {
      if (ctrl.signal.aborted) return;
      if (r.status === "ok") last.current = r.data;
      setState(r.status === "loading" ? { status: "loading", data: last.current } : r);
    });
    return () => ctrl.abort();
  }, [path, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}
