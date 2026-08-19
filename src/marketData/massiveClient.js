import WebSocket from "ws";
import { EventEmitter } from "node:events";

/**
 * Cliente del feed en tiempo real de Massive (ex-Polygon.io) para forex.
 * Emite ticks normalizados: { price, bid, ask, timestamp }
 *
 * Reconexión automática con backoff, y heartbeat para detectar conexiones
 * muertas silenciosas (típico en streams 24/5 de forex).
 *
 * IMPORTANTE: el nombre exacto del canal ("C:XAUUSD" vs otra convención) y el
 * formato exacto del mensaje pueden cambiar entre versiones de la API.
 * Verificar contra la documentación vigente de Massive antes de producción:
 * https://massive.com/docs (o https://polygon.io/docs/websocket/forex)
 */
export class MassiveMarketDataClient extends EventEmitter {
  constructor({ apiKey, wsUrl, symbol }) {
    super();
    this.apiKey = apiKey;
    this.wsUrl = wsUrl;
    this.symbol = symbol;
    this.ws = null;
    this.reconnectAttempts = 0;
    this.heartbeatTimer = null;
    this.lastMessageAt = Date.now();
  }

  connect() {
    this.ws = new WebSocket(this.wsUrl);

    this.ws.on("open", () => {
      this.reconnectAttempts = 0;
      this._authenticate();
      this._startHeartbeatWatchdog();
      this.emit("status", "connected");
    });

    this.ws.on("message", (raw) => this._handleMessage(raw));

    this.ws.on("close", () => {
      this.emit("status", "disconnected");
      this._scheduleReconnect();
    });

    this.ws.on("error", (err) => {
      this.emit("error", err);
    });
  }

  _authenticate() {
    this.ws.send(JSON.stringify({ action: "auth", params: this.apiKey }));
    // Suscripción al canal de quotes (bid/ask en tiempo real) del símbolo.
    this.ws.send(
      JSON.stringify({ action: "subscribe", params: `C.${this.symbol}` })
    );
  }

  _handleMessage(raw) {
    this.lastMessageAt = Date.now();
    let events;
    try {
      events = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!Array.isArray(events)) events = [events];

    for (const evt of events) {
      if (evt.ev === "status") {
        this.emit("status", evt.message ?? evt.status);
        continue;
      }
      // Evento de quote: bid/ask -> derivamos precio medio como referencia.
      if (evt.ev === "C" || evt.ev === "CA") {
        const bid = evt.b ?? evt.bp;
        const ask = evt.a ?? evt.ap;
        if (bid == null || ask == null) continue;
        const price = (bid + ask) / 2;
        this.emit("tick", {
          price,
          bid,
          ask,
          timestamp: evt.t ?? Date.now(),
        });
      }
    }
  }

  _startHeartbeatWatchdog() {
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      const silentFor = Date.now() - this.lastMessageAt;
      // Forex opera 24/5: más de 20s sin ningún mensaje en horario de mercado
      // es sospechoso -> forzamos reconexión.
      if (silentFor > 20_000) {
        this.emit("status", "stale-connection, forcing reconnect");
        this.ws.terminate();
      }
    }, 10_000);
  }

  _scheduleReconnect() {
    clearInterval(this.heartbeatTimer);
    this.reconnectAttempts += 1;
    const delay = Math.min(30_000, 1000 * 2 ** this.reconnectAttempts);
    setTimeout(() => this.connect(), delay);
  }

  close() {
    clearInterval(this.heartbeatTimer);
    this.ws?.close();
  }
}
