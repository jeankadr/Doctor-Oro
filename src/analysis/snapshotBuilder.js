import { rsi, atr, swingStructure, trendBias } from "./indicators.js";

// Cuántas velas cerradas mínimas se necesitan antes de generar el primer
// snapshot. 25 es el valor recomendado para producción (RSI/estructura con
// suficiente historia real). Bájalo temporalmente (ej: 3) solo para probar
// rápido que el pipeline completo funciona de punta a punta — con pocas
// velas el análisis es menos confiable, no lo dejes bajo para operar real.
const MIN_CANDLES = Number(process.env.MIN_CANDLES_FOR_SNAPSHOT || 25);

/**
 * Empaqueta el estado real del mercado (M1 + M5) en un snapshot estructurado.
 * Esto es lo único que la IA recibe como "verdad" del mercado — nunca ve
 * precios crudos sin procesar, siempre indicadores ya calculados por código
 * determinista.
 */
export function buildSnapshot({ m1Candles, m5Candles, currentPrice }) {
  if (m1Candles.length < MIN_CANDLES || m5Candles.length < MIN_CANDLES) return null;

  const m1Closes = m1Candles.map((c) => c.close);
  const m5Closes = m5Candles.map((c) => c.close);

  const m1Structure = swingStructure(m1Candles);
  const m5Structure = swingStructure(m5Candles);

  return {
    symbol: "XAU/USD",
    generatedAt: new Date().toISOString(),
    currentPrice,
    m1: {
      trendBias: trendBias(m1Closes),
      rsi14: rsi(m1Closes, 14),
      atr14: atr(m1Candles, 14),
      structure: m1Structure.label,
      structureBias: m1Structure.bias,
      lastCandles: m1Candles.slice(-10).map(round4Candle),
    },
    m5: {
      trendBias: trendBias(m5Closes),
      rsi14: rsi(m5Closes, 14),
      atr14: atr(m5Candles, 14),
      structure: m5Structure.label,
      structureBias: m5Structure.bias,
      lastCandles: m5Candles.slice(-10).map(round4Candle),
    },
  };
}

function round4Candle(c) {
  const r = (n) => Math.round(n * 10000) / 10000;
  return { time: c.time, open: r(c.open), high: r(c.high), low: r(c.low), close: r(c.close) };
}
