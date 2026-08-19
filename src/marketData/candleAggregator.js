/**
 * Convierte un stream de ticks (precio + timestamp) en velas OHLC cerradas,
 * para uno o más timeframes en paralelo (ej: M1 y M5).
 *
 * No depende de ningún proveedor específico: recibe ticks ya normalizados
 * como { price, bid, ask, timestamp } desde el cliente del proveedor.
 */
export class CandleAggregator {
  /**
   * @param {number[]} timeframesMinutes ej: [1, 5]
   * @param {(tf:number, candle:object) => void} onCandleClose
   */
  constructor(timeframesMinutes, onCandleClose) {
    this.timeframes = timeframesMinutes;
    this.onCandleClose = onCandleClose;
    this.current = new Map(); // tf -> current open candle
  }

  _bucketStart(tf, tsMs) {
    const bucketMs = tf * 60_000;
    return Math.floor(tsMs / bucketMs) * bucketMs;
  }

  onTick({ price, bid, ask, timestamp }) {
    for (const tf of this.timeframes) {
      const bucketStart = this._bucketStart(tf, timestamp);
      let candle = this.current.get(tf);

      if (!candle || candle.bucketStart !== bucketStart) {
        // Cierra la vela anterior si existía (y ya tiene datos reales)
        if (candle) this.onCandleClose(tf, candle);

        candle = {
          tf,
          bucketStart,
          time: new Date(bucketStart).toISOString(),
          open: price,
          high: price,
          low: price,
          close: price,
          bid,
          ask,
          ticks: 1,
        };
        this.current.set(tf, candle);
      } else {
        candle.high = Math.max(candle.high, price);
        candle.low = Math.min(candle.low, price);
        candle.close = price;
        candle.bid = bid;
        candle.ask = ask;
        candle.ticks += 1;
      }
    }
  }

  /** Vela en formación (para mostrar precio "live" en el dashboard) */
  getOpenCandle(tf) {
    return this.current.get(tf) ?? null;
  }
}
