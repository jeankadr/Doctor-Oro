"""
Puente entre tu terminal MetaTrader 5 (local, Windows) y el backend
xauusd-ai-engine (Render/nube).

Qué hace:
  1. Se conecta al MT5 que ya tienes abierto e iniciado sesión en tu compu.
  2. Lee el precio de XAUUSD en vivo (bid/ask) en un loop corto.
  3. Empuja cada tick al backend por WebSocket, para que el Analysis Engine,
     la IA y el Risk Engine lo procesen exactamente igual que si viniera
     de un proveedor de datos externo.

Requisitos (correr esto en la MISMA compu donde está instalado MT5):
    pip install MetaTrader5 websockets

Uso:
    python mt5_bridge.py
"""

import asyncio
import json
import time
import os

import MetaTrader5 as mt5
import websockets

# ---- Configuración: ajusta estos 3 valores ----
BACKEND_WS_URL = os.environ.get(
    "BACKEND_INGEST_URL", "wss://TU-APP.onrender.com/ingest"
)
INGEST_TOKEN = os.environ.get("INGEST_AUTH_TOKEN", "cambia-este-token")

# El nombre exacto del símbolo puede variar por bróker: "XAUUSD", "XAUUSD.m",
# "GOLD", "XAUUSDm", etc. Ábrelo en Market Watch de tu MT5 (clic derecho ->
# "Show All" y busca "XAU") y copia el nombre EXACTO que aparece ahí.
SYMBOL = os.environ.get("MT5_SYMBOL", "XAUUSD")

POLL_INTERVAL_SECONDS = 0.5  # cada cuánto se revisa el último tick


def connect_mt5():
    if not mt5.initialize():
        raise RuntimeError(f"No se pudo inicializar MT5: {mt5.last_error()}")

    if not mt5.symbol_select(SYMBOL, True):
        raise RuntimeError(
            f"El símbolo '{SYMBOL}' no existe en tu Market Watch. "
            "Revisa el nombre exacto en MT5 (clic derecho -> Show All)."
        )

    print(f"[MT5] Conectado. Escuchando símbolo: {SYMBOL}")


async def stream_ticks():
    last_time = None
    url = f"{BACKEND_WS_URL}?token={INGEST_TOKEN}"

    while True:
        try:
            async with websockets.connect(url) as ws:
                print(f"[Bridge] Conectado al backend: {BACKEND_WS_URL}")
                while True:
                    tick = mt5.symbol_info_tick(SYMBOL)
                    if tick is None:
                        await asyncio.sleep(POLL_INTERVAL_SECONDS)
                        continue

                    # Evita reenviar el mismo tick si el precio no se ha movido.
                    if tick.time_msc == last_time:
                        await asyncio.sleep(POLL_INTERVAL_SECONDS)
                        continue
                    last_time = tick.time_msc

                    payload = {
                        "price": (tick.bid + tick.ask) / 2,
                        "bid": tick.bid,
                        "ask": tick.ask,
                        "timestamp": tick.time_msc,
                    }
                    await ws.send(json.dumps(payload))
                    await asyncio.sleep(POLL_INTERVAL_SECONDS)

        except (websockets.ConnectionClosed, OSError) as e:
            print(f"[Bridge] Conexión perdida ({e}). Reintentando en 5s...")
            await asyncio.sleep(5)


if __name__ == "__main__":
    connect_mt5()
    try:
        asyncio.run(stream_ticks())
    finally:
        mt5.shutdown()
