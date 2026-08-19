import Anthropic from "@anthropic-ai/sdk";

const SIGNAL_TOOL = {
  name: "emit_trading_signal",
  description:
    "Emite el veredicto de análisis para XAU/USD basado únicamente en el snapshot de mercado proporcionado.",
  input_schema: {
    type: "object",
    properties: {
      direction: { type: "string", enum: ["BUY", "SELL", "WAIT"] },
      confidence: {
        type: "number",
        description: "0-100. Qué tan claro es el setup de scalping.",
      },
      entry: {
        type: "number",
        description: "Precio de entrada sugerido. Igual a currentPrice si direction != WAIT.",
      },
      stopLossPips: {
        type: "number",
        description: "Distancia del SL en unidades de precio (no en porcentaje).",
      },
      reasoning: {
        type: "array",
        items: { type: "string" },
        description: "3-6 razones concretas basadas en los datos del snapshot, en español.",
      },
      invalidatedBy: {
        type: "string",
        description: "Qué condición del mercado invalidaría este análisis.",
      },
    },
    required: ["direction", "confidence", "reasoning"],
  },
};

const SYSTEM_PROMPT = `Eres el motor de análisis de un sistema de señales de scalping para XAU/USD.

Reglas estrictas:
- Solo puedes basarte en los datos del snapshot que se te entrega (indicadores M1/M5 ya calculados). Nunca inventes precios ni indicadores que no estén en el snapshot.
- XAU/USD es volátil: exige confluencia real entre M1 y M5 antes de sugerir BUY o SELL. Si la evidencia es ambigua o contradictoria, responde WAIT.
- No sobreestimes confianza: usa 85-100 solo cuando estructura, RSI y sesgo de tendencia en ambos timeframes apuntan claramente en la misma dirección.
- Sé conservador: en scalping, un WAIT correcto vale más que una señal forzada.
- La razón de invalidación debe ser específica y verificable contra el precio (ej: "si el precio rompe por debajo de 4180.20").
- Responde siempre usando la herramienta emit_trading_signal, nunca en texto libre.`;

export class AiEngine {
  constructor({ apiKey, model }) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  /**
   * @param {object} snapshot ver snapshotBuilder.js
   * @returns {Promise<object|null>} veredicto de la IA, o null si no pudo generar uno válido
   */
  async analyze(snapshot) {
    const message = await this.client.messages.create({
      model: this.model,
      max_tokens: 700,
      system: SYSTEM_PROMPT,
      tools: [SIGNAL_TOOL],
      tool_choice: { type: "tool", name: "emit_trading_signal" },
      messages: [
        {
          role: "user",
          content: `Snapshot actual del mercado:\n${JSON.stringify(snapshot, null, 2)}`,
        },
      ],
    });

    const toolUse = message.content.find((b) => b.type === "tool_use");
    if (!toolUse) return null;

    return {
      ...toolUse.input,
      rawUsage: message.usage,
    };
  }
}
