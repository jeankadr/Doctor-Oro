# XAUUSD AI Signal Engine — MVP backend real

Reemplaza el prototipo simulado (`Math.random()`) por un pipeline real:

```
Massive WS (ticks XAU/USD)
  → Market Data Service (candleAggregator.js)
  → Analysis Engine (indicators.js — RSI/ATR/estructura, 100% determinista)
  → AI Engine (aiEngine.js — Claude interpreta el snapshot y decide dirección/confianza)
  → Risk Engine (riskEngine.js — calcula SL/TP1/TP2/TP3 con ATR real, aplica límites)
  → Signal Store (SQLite — persistente, no se borra al refrescar)
  → Outcome Tracker (marca WIN/LOSS comparando precio en vivo vs SL/TP)
  → WebSocket → public/index.html (tu dashboard)
```

## Setup local

```bash
npm install
cp .env.example .env
# completa MASSIVE_API_KEY y ANTHROPIC_API_KEY en .env
npm start
```

Abre **http://localhost:8080** (no abras `public/index.html` como archivo
suelto con doble clic — necesita venir del mismo servidor que expone el
WebSocket, o el navegador bloqueará la conexión).

## Despliegue con Docker

```bash
cp .env.example .env   # completa tus API keys reales
docker compose up -d --build
```

Esto deja el backend + dashboard sirviendo en el puerto 8080, con
`./data/signals.db` persistiendo fuera del contenedor (sobrevive a
`docker compose down` / rebuilds).

**Para producción real** necesitas HTTPS/WSS (los navegadores bloquean
WebSocket sin cifrar desde una página servida por HTTPS). Pon un reverse
proxy delante del contenedor — Caddy es la opción más simple porque
gestiona el certificado TLS solo:

```
# Caddyfile
tudominio.com {
    reverse_proxy localhost:8080
}
```

Con eso, `wss://tudominio.com/ws` funciona automáticamente (el frontend ya
detecta `https:` y usa `wss://` solo).

## Cosas que TIENES que verificar antes de producción

1. **Canal WebSocket exacto de Massive para XAU/USD.** En `massiveClient.js`
   dejé el formato de canal documentado (`C:XAUUSD`) pero Massive puede haber
   cambiado convenciones desde la última vez que se revisó su documentación
   pública. Antes de ir a producción, confirma el nombre exacto del canal y
   el formato del mensaje contra `https://massive.com/docs` con tu API key
   real (yo no pude probarlo en vivo: este entorno no tiene acceso de red).

2. **Licencia de redistribución.** Si vas a mostrar señales derivadas a
   usuarios de pago (SaaS comercial), confirma con el equipo de ventas de
   Massive que tu plan cubre ese caso de uso, no solo uso interno.

3. **Paper trading antes de señales reales.** El Risk Engine ya filtra por
   confianza mínima y R:R mínimo, pero antes de mostrarle señales a
   usuarios de pago, corre el sistema en modo "shadow" (solo logueando,
   sin publicar) durante al menos unas semanas de mercado real y revisa el
   win rate en `store.getStats()`.

4. **Costo de IA escala con frecuencia de señales.** Ahora mismo se llama a
   Claude en cada cierre de vela M1 (una vez por minuto por símbolo). Si
   agregas más símbolos o bajas a M1→tick, el costo sube proporcionalmente.

## Qué falta para siguientes iteraciones (no incluido en este MVP)

- Autenticación de usuarios / multi-tenant en el dashboard.
- Panel de administración para ajustar `minConfidence`, `minRiskReward`, etc. sin redeploy.
- Integración con broker para ejecución (fase 2, según la arquitectura que ya definimos).
- Alertas (Telegram/email) cuando se emite una señal nueva.
- Backtesting histórico contra datos pasados de Massive antes de operar en vivo.
