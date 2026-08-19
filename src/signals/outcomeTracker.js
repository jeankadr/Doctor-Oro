/**
 * Con cada tick de precio real, revisa las señales abiertas y las cierra
 * cuando el precio toca SL o TP2 (usamos TP2 como objetivo de cierre de
 * referencia; TP1 y TP3 quedan registrados para estadísticas de parciales).
 */
export class OutcomeTracker {
  constructor({ store, onSignalClosed }) {
    this.store = store;
    this.onSignalClosed = onSignalClosed;
  }

  onPriceTick(price) {
    const open = this.store.getOpenSignals();
    for (const s of open) {
      const isBuy = s.direction === "BUY";
      const hitSl = isBuy ? price <= s.sl : price >= s.sl;
      const hitTp2 = isBuy ? price >= s.tp2 : price <= s.tp2;

      if (hitSl) {
        this.store.closeSignal(s.id, { result: "LOSS", closedPrice: price });
        this.onSignalClosed?.({ ...s, result: "LOSS", closedPrice: price });
      } else if (hitTp2) {
        this.store.closeSignal(s.id, { result: "WIN", closedPrice: price });
        this.onSignalClosed?.({ ...s, result: "WIN", closedPrice: price });
      }
    }
  }
}
