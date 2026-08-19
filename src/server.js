import "dotenv/config";
import { WebSocketServer } from "ws";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_DIR = join(__dirname, "..", "public");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

import { MassiveMarketDataClient } from "./marketData/massiveClient.js";
import { CandleAggregator } from "./marketData/candleAggregator.js";
import { buildSnapshot } from "./analysis/snapshotBuilder.js";
import { AiEngine } from "./ai/aiEngine.js";
import { RiskEngine } from "./risk/riskEngine.js";
import { SignalStore } from "./signals/signalStore.js";
import { OutcomeTracker } from "./signals/outcomeTracker.js";

const cfg = {
  massiveApiKey: process.env.MASSIVE_API_KEY,
  massiveWsUrl: process.env.MASSIVE_WS_URL,
  massiveSymbol: process.env.MASSIVE_SYMBOL,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  anthropicModel: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
  port: Number(process.env.PORT || 8080),
  dbPath: process.env.DB_PATH || "./data/signals.db",
  maxSignalsPerHour: Number(process.env.MAX_SIGNALS_PER_HOUR || 15),
  minRiskReward: Number(process.env.MIN_RISK_REWARD || 1.5),
  slAtrMultiplier: Number(process.env.SL_ATR_MULTIPLIER || 1.5),
  tp1AtrMultiplier: Number(process.env.TP1_ATR_MULTIPLIER || 1.0),
  tp2AtrMultiplier: Number(process.env.TP2_ATR_MULTIPLIER || 2.0),
  tp3AtrMultiplier: Number(process.env.TP3_ATR_MULTIPLIER || 3.5),
};

// ---- Piezas del pipeline ----
const store = new SignalStore(cfg.dbPath);
const riskEngine = new RiskEngine(cfg);
const aiEngine = new AiEngine({
  apiKey: cfg.anthropicApiKey,
  model: cfg.anthropicModel,
});
const outcomeTracker = new OutcomeTracker({
  store,
  onSignalClosed: (closed) => broadcast({ type: "SIGNAL_CLOSED", signal: closed }),
});

let m1Candles = [];
let m5Candles = [];
let lastPrice = null;
let analyzing = false; // evita solapar llamadas a la IA

const aggregator = new CandleAggregator([1, 5], (tf, candle) => {
  if (tf === 1) {
    m1Candles.push(candle);
    if (m1Candles.length > 200) m1Candles.shift();
    // Al cerrar cada vela M1 evaluamos si hay condiciones para pedirle
    // análisis a la IA (no en cada tick: eso sería carísimo y lento).
    maybeRunAnalysis();
  }
  if (tf === 5) {
    m5Candles.push(candle);
    if (m5Candles.length > 200) m5Candles.shift();
  }
});

async function maybeRunAnalysis() {
  if (analyzing) return;
  const snapshot = buildSnapshot({ m1Candles, m5Candles, currentPrice: lastPrice });
  if (!snapshot) return;

  analyzing = true;
  broadcast({ type: "ANALYSIS_STARTED" });
  try {
    const aiVerdict = await aiEngine.analyze(snapshot);
    const result = riskEngine.evaluate(aiVerdict, snapshot);

    broadcast({ type: "ANALYSIS_RESULT", snapshot, aiVerdict, result });

    if (result.ok) {
      const id = store.insert(result.signal);
      broadcast({ type: "NEW_SIGNAL", id, signal: result.signal });
    }
  } catch (err) {
    console.error("[AI Engine] error:", err.message);
    broadcast({ type: "ANALYSIS_ERROR", message: err.message });
  } finally {
    analyzing = false;
  }
}

// ---- Market data ----
const marketClient = new MassiveMarketDataClient({
  apiKey: cfg.massiveApiKey,
  wsUrl: cfg.massiveWsUrl,
  symbol: cfg.massiveSymbol,
});

marketClient.on("tick", (tick) => {
  lastPrice = tick.price;
  aggregator.onTick(tick);
  outcomeTracker.onPriceTick(tick.price);
  broadcast({ type: "PRICE_TICK", price: tick.price, bid: tick.bid, ask: tick.ask });
});

marketClient.on("status", (s) => broadcast({ type: "FEED_STATUS", status: s }));
marketClient.on("error", (e) => console.error("[MarketData] error:", e.message));

// ---- HTTP: sirve el dashboard estático (mismo origen que el WS -> sin CORS ni mixed content) ----
const httpServer = createServer(async (req, res) => {
  try {
    const path = req.url === "/" ? "/index.html" : req.url;
    const filePath = join(PUBLIC_DIR, path);
    if (!filePath.startsWith(PUBLIC_DIR)) throw new Error("forbidden");
    const body = await readFile(filePath);
    res.writeHead(200, { "Content-Type": MIME[extname(filePath)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});

// ---- WebSocket hacia el dashboard ----
const wss = new WebSocketServer({ server: httpServer, path: process.env.DASHBOARD_WS_PATH || "/ws" });

function broadcast(payload) {
  const msg = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(msg);
  }
}

wss.on("connection", (socket) => {
  socket.send(
    JSON.stringify({
      type: "INIT",
      openSignals: store.getOpenSignals(),
      history: store.getRecentHistory(50),
      stats: store.getStats(),
    })
  );
});

httpServer.listen(cfg.port, () => {
  console.log(`Dashboard WS escuchando en :${cfg.port}${process.env.DASHBOARD_WS_PATH || "/ws"}`);
  marketClient.connect();
});
