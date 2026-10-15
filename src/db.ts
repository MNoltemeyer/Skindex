import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";

// Make sure the "data" folder exists, then open (or create) the database file.
mkdirSync("data", { recursive: true });
export const db = new DatabaseSync("data/skins.db");

// Create the tables the first time the app runs.
// "IF NOT EXISTS" means running this again is harmless.
db.exec(`
  CREATE TABLE IF NOT EXISTS skins (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    market_hash_name TEXT NOT NULL UNIQUE  -- e.g. "AK-47 | Redline (Field-Tested)"
  );

  CREATE TABLE IF NOT EXISTS prices (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    skin_id     INTEGER NOT NULL REFERENCES skins(id),
    price_cents INTEGER NOT NULL,          -- store money as whole cents to avoid rounding errors
    currency    TEXT NOT NULL DEFAULT 'USD',
    recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// TypeScript "types" describe the shape of our data.
export type Skin = {
  id: number;
  market_hash_name: string;
};

export type PriceRecord = {
  price_cents: number;
  currency: string;
  recorded_at: string;
};

// Add a skin if it isn't already saved, and return it either way.
export function getOrCreateSkin(marketHashName: string): Skin {
  db.prepare("INSERT OR IGNORE INTO skins (market_hash_name) VALUES (?)").run(marketHashName);
  const row = db
    .prepare("SELECT id, market_hash_name FROM skins WHERE market_hash_name = ?")
    .get(marketHashName);
  return row as Skin;
}

// Save one price reading for a skin.
export function recordPrice(skinId: number, priceCents: number, currency = "USD"): void {
  db.prepare("INSERT INTO prices (skin_id, price_cents, currency) VALUES (?, ?, ?)").run(
    skinId,
    priceCents,
    currency,
  );
}

// Get every saved price for a skin, oldest first.
export function getPriceHistory(skinId: number): PriceRecord[] {
  const rows = db
    .prepare(
      "SELECT price_cents, currency, recorded_at FROM prices WHERE skin_id = ? ORDER BY recorded_at, id",
    )
    .all(skinId);
  return rows as PriceRecord[];
}
