import type { ClientMessage, ServerMessage } from "@genesis/protocol";

export type SocketStatus = "connecting" | "open" | "reconnecting";

type MessageHandler = (msg: ServerMessage) => void;
type StatusHandler = (status: SocketStatus, attempt: number) => void;

/**
 * Cliente WebSocket con reconexión (backoff exponencial). Tras reconectar
 * manda `hello` para pedir un snapshot fresco y reenvía la suscripción activa.
 */
export class GenesisSocket {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private timer: number | null = null;
  private closedByUser = false;
  private snapshotSeen = false;
  private helloTimer: number | null = null;
  private handlers = new Set<MessageHandler>();
  private statusHandlers = new Set<StatusHandler>();
  private queue: ClientMessage[] = [];
  /** el último `subscribe` enviado, para repetirlo al reconectar */
  private subscribed: number | null = null;
  status: SocketStatus = "connecting";

  onMessage(h: MessageHandler): () => void {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }

  onStatus(h: StatusHandler): () => void {
    this.statusHandlers.add(h);
    return () => this.statusHandlers.delete(h);
  }

  connect(): void {
    this.closedByUser = false;
    this.open();
  }

  close(): void {
    this.closedByUser = true;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.ws?.close();
  }

  send(msg: ClientMessage): void {
    if (msg.t === "subscribe") this.subscribed = msg.agentId;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else if (msg.t !== "hello") {
      this.queue.push(msg);
      if (this.queue.length > 50) this.queue.shift();
    }
  }

  private url(): string {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${location.host}/ws`;
  }

  private setStatus(s: SocketStatus): void {
    this.status = s;
    for (const h of this.statusHandlers) h(s, this.attempt);
  }

  private open(): void {
    if (this.closedByUser) return;
    const ws = new WebSocket(this.url());
    this.ws = ws;
    this.snapshotSeen = false;
    ws.onopen = () => {
      const wasReconnect = this.attempt > 0;
      this.attempt = 0;
      this.setStatus("open");
      if (wasReconnect) ws.send(JSON.stringify({ t: "hello" } satisfies ClientMessage));
      if (this.subscribed !== null) ws.send(JSON.stringify({ t: "subscribe", agentId: this.subscribed } satisfies ClientMessage));
      for (const m of this.queue.splice(0)) ws.send(JSON.stringify(m));
      // si el snapshot inicial no llega, lo pedimos explícitamente
      this.helloTimer = window.setTimeout(() => {
        if (!this.snapshotSeen && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: "hello" } satisfies ClientMessage));
      }, 3000);
    };
    ws.onmessage = (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      if (msg.t === "snapshot") this.snapshotSeen = true;
      for (const h of this.handlers) h(msg);
    };
    ws.onclose = () => {
      if (this.helloTimer !== null) window.clearTimeout(this.helloTimer);
      if (this.ws === ws) this.ws = null;
      if (this.closedByUser) return;
      this.attempt += 1;
      this.setStatus("reconnecting");
      const delay = Math.min(10_000, 500 * 2 ** Math.min(6, this.attempt - 1)) + Math.random() * 250;
      this.timer = window.setTimeout(() => this.open(), delay);
    };
    ws.onerror = () => {
      // onclose se dispara después y maneja la reconexión
    };
  }
}

export const socket = new GenesisSocket();
