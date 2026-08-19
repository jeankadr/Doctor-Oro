/**
 * Convierte el veredicto "crudo" de la IA en una señal operable, o la
 * rechaza si no cumple las reglas de riesgo. Esta capa es intencionalmente
 * determinista y no confía ciegamente en la IA: la IA decide dirección y
 * confianza; el Risk Engine decide si esa señal es segura de publicar.
 */
export class RiskEngine {
  constructor({
    maxSignalsPerHour = 15,
    minRiskReward = 1.5,
    slAtrMultiplier = 1.5,
    tp1AtrMultiplier = 1.0,
    tp2AtrMultiplier = 2.0,
    tp3AtrMultiplier = 3.5,
    minConfidence = 70,
  } = {}) {
    this.maxSignalsPerHour = maxSignalsPerHour;
    this.minRiskReward = minRiskReward;
    this.slAtrMultiplier = slAtrMultiplier;
    this.tp1AtrMultiplier = tp1AtrMultiplier;
    this.tp2AtrMultiplier = tp2AtrMultiplier;
    this.tp3AtrMultiplier = tp3AtrMultiplier;
    this.minConfidence = minConfidence;
    this.recentSignalTimestamps = [];
  }

  _withinRateLimit() {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    this.recentSignalTimestamps = this.recentSignalTimestamps.filter(
      (t) => t > oneHourAgo
    );
    return this.recentSignalTimestamps.length < this.maxSignalsPerHour;
  }

  /**
   * @param {object} aiVerdict salida de AiEngine.analyze()
   * @param {object} snapshot mismo snapshot que recibió la IA (para ATR real)
   * @returns {{ok:true, signal:object} | {ok:false, reason:string}}
   */
  evaluate(aiVerdict, snapshot) {
    if (!aiVerdict || aiVerdict.direction === "WAIT") {
      return { ok: false, reason: "AI_WAIT" };
    }
    if (aiVerdict.confidence < this.minConfidence) {
      return { ok: false, reason: `LOW_CONFIDENCE(${aiVerdict.confidence})` };
    }
    if (!this._withinRateLimit()) {
      return { ok: false, reason: "RATE_LIMIT_EXCEEDED" };
    }

    const atr = snapshot.m1.atr14;
    if (!atr || atr <= 0) {
      return { ok: false, reason: "NO_ATR_DATA" };
    }

    const entry = aiVerdict.entry ?? snapshot.currentPrice;
    const sign = aiVerdict.direction === "BUY" ? 1 : -1;

    const sl = entry - sign * atr * this.slAtrMultiplier;
    const tp1 = entry + sign * atr * this.tp1AtrMultiplier;
    const tp2 = entry + sign * atr * this.tp2AtrMultiplier;
    const tp3 = entry + sign * atr * this.tp3AtrMultiplier;

    const risk = Math.abs(entry - sl);
    const reward = Math.abs(tp2 - entry); // TP2 como objetivo de referencia para R:R
    const riskReward = reward / risk;

    if (riskReward < this.minRiskReward) {
      return { ok: false, reason: `RR_TOO_LOW(${riskReward.toFixed(2)})` };
    }

    this.recentSignalTimestamps.push(Date.now());

    return {
      ok: true,
      signal: {
        direction: aiVerdict.direction,
        confidence: aiVerdict.confidence,
        entry: round2(entry),
        sl: round2(sl),
        tp1: round2(tp1),
        tp2: round2(tp2),
        tp3: round2(tp3),
        riskReward: round2(riskReward),
        reasoning: aiVerdict.reasoning,
        invalidatedBy: aiVerdict.invalidatedBy ?? null,
        atrUsed: round2(atr),
        createdAt: new Date().toISOString(),
      },
    };
  }
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
