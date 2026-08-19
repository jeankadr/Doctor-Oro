/**
 * Indicadores técnicos deterministas, calculados sobre velas OHLC reales.
 * Nada aquí es aleatorio: esta es la diferencia central frente al prototipo.
 */

export function ema(values, period) {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const out = [values[0]];
  for (let i = 1; i < values.length; i++) {
    out.push(values[i] * k + out[i - 1] * (1 - k));
  }
  return out;
}

export function rsi(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function atr(candles, period = 14) {
  if (candles.length < period + 1) return null;
  const trueRanges = [];
  for (let i = 1; i < candles.length; i++) {
    const cur = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low - prev.close)
    );
    trueRanges.push(tr);
  }
  const last = trueRanges.slice(-period);
  return last.reduce((a, b) => a + b, 0) / last.length;
}

/**
 * Detección simple de estructura de mercado (swing highs/lows) sobre las
 * últimas N velas, para clasificar HH/HL (alcista) vs LH/LL (bajista).
 */
export function swingStructure(candles, lookback = 20) {
  const recent = candles.slice(-lookback);
  if (recent.length < 5) return { label: "INSUFFICIENT_DATA", bias: null };

  const swingHighs = [];
  const swingLows = [];
  for (let i = 2; i < recent.length - 2; i++) {
    const c = recent[i];
    const isHigh =
      c.high > recent[i - 1].high &&
      c.high > recent[i - 2].high &&
      c.high > recent[i + 1].high &&
      c.high > recent[i + 2].high;
    const isLow =
      c.low < recent[i - 1].low &&
      c.low < recent[i - 2].low &&
      c.low < recent[i + 1].low &&
      c.low < recent[i + 2].low;
    if (isHigh) swingHighs.push(c.high);
    if (isLow) swingLows.push(c.low);
  }

  if (swingHighs.length < 2 || swingLows.length < 2) {
    return { label: "RANGE_OR_INSUFFICIENT", bias: null };
  }

  const higherHighs = swingHighs.at(-1) > swingHighs.at(-2);
  const higherLows = swingLows.at(-1) > swingLows.at(-2);

  if (higherHighs && higherLows) return { label: "HH -> HL", bias: "bullish" };
  if (!higherHighs && !higherLows) return { label: "LH -> LL", bias: "bearish" };
  return { label: "MIXED", bias: null };
}

export function trendBias(closes, fastPeriod = 8, slowPeriod = 21) {
  if (closes.length < slowPeriod) return null;
  const fast = ema(closes, fastPeriod).at(-1);
  const slow = ema(closes, slowPeriod).at(-1);
  return fast > slow ? "bullish" : "bearish";
}
