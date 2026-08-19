import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export class SignalStore {
  constructor(dbPath) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this._migrate();
  }

  _migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS signals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        direction TEXT NOT NULL,
        confidence REAL NOT NULL,
        entry REAL NOT NULL,
        sl REAL NOT NULL,
        tp1 REAL NOT NULL,
        tp2 REAL NOT NULL,
        tp3 REAL NOT NULL,
        risk_reward REAL NOT NULL,
        reasoning TEXT NOT NULL,
        invalidated_by TEXT,
        atr_used REAL,
        status TEXT NOT NULL DEFAULT 'OPEN',
        result TEXT,
        closed_at TEXT,
        closed_price REAL
      );
    `);
  }

  insert(signal) {
    const stmt = this.db.prepare(`
      INSERT INTO signals
        (created_at, direction, confidence, entry, sl, tp1, tp2, tp3, risk_reward, reasoning, invalidated_by, atr_used, status)
      VALUES (@createdAt, @direction, @confidence, @entry, @sl, @tp1, @tp2, @tp3, @riskReward, @reasoning, @invalidatedBy, @atrUsed, 'OPEN')
    `);
    const info = stmt.run({
      ...signal,
      reasoning: JSON.stringify(signal.reasoning),
    });
    return info.lastInsertRowid;
  }

  getOpenSignals() {
    return this.db
      .prepare(`SELECT * FROM signals WHERE status = 'OPEN'`)
      .all()
      .map(deserialize);
  }

  closeSignal(id, { result, closedPrice }) {
    this.db
      .prepare(
        `UPDATE signals SET status = 'CLOSED', result = ?, closed_at = ?, closed_price = ? WHERE id = ?`
      )
      .run(result, new Date().toISOString(), closedPrice, id);
  }

  getRecentHistory(limit = 50) {
    return this.db
      .prepare(
        `SELECT * FROM signals WHERE status = 'CLOSED' ORDER BY closed_at DESC LIMIT ?`
      )
      .all(limit)
      .map(deserialize);
  }

  getStats() {
    const row = this.db
      .prepare(
        `SELECT
           COUNT(*) as total,
           SUM(CASE WHEN result = 'WIN' THEN 1 ELSE 0 END) as wins,
           SUM(CASE WHEN result = 'LOSS' THEN 1 ELSE 0 END) as losses
         FROM signals WHERE status = 'CLOSED'`
      )
      .get();
    const winRate = row.total > 0 ? (row.wins / row.total) * 100 : null;
    return { ...row, winRate };
  }
}

function deserialize(row) {
  return { ...row, reasoning: JSON.parse(row.reasoning ?? "[]") };
}
