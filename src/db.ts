import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";

// Make sure the "data" folder exists, then open (or create) the database file.
mkdirSync("data", { recursive: true });
export const db = new DatabaseSync("data/skins.db");

// "WAL" mode lets the web page read the database while the tracker is
// saving new prices, without either one having to wait for the other.
db.exec("PRAGMA journal_mode = WAL");

// If the database is busy for a moment (another program is saving), wait up
// to 5 seconds for it instead of failing straight away.
db.exec("PRAGMA busy_timeout = 5000");

// Create the tables the first time the app runs.
// "IF NOT EXISTS" means running this again is harmless.
db.exec(`
  CREATE TABLE IF NOT EXISTS skins (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    market_hash_name TEXT NOT NULL UNIQUE, -- e.g. "AK-47 | Redline (Field-Tested)"
    icon_url         TEXT                  -- Steam's ID for the skin's picture (can be empty)
  );

  CREATE TABLE IF NOT EXISTS prices (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    skin_id     INTEGER NOT NULL REFERENCES skins(id),
    price_cents INTEGER NOT NULL,          -- store money as whole cents to avoid rounding errors
    currency    TEXT NOT NULL DEFAULT 'USD',
    recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- At most one row (id must be 1). If the row exists, an update is running,
  -- and pid says which program is running it.
  CREATE TABLE IF NOT EXISTS update_lock (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    pid        INTEGER NOT NULL,
    started_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// A database made before pictures were added has a "skins" table without the
// icon_url column, and "CREATE TABLE IF NOT EXISTS" won't change an existing
// table. So check for the column, and add it if it's missing. This kind of
// "upgrade an existing database" step is called a migration.
const skinColumns = db.prepare("PRAGMA table_info(skins)").all() as { name: string }[];
if (!skinColumns.some((column) => column.name === "icon_url")) {
  db.exec("ALTER TABLE skins ADD COLUMN icon_url TEXT");
}

// TypeScript "types" describe the shape of our data.
export type Skin = {
  id: number;
  market_hash_name: string;
};

export type SkinIcon = {
  id: number;
  icon_url: string;
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

// Save a price for every skin in one go. A "transaction" means either all of
// them are saved, or (if something goes wrong halfway) none are.
export function recordPrices(
  items: { name: string; priceCents: number; iconUrl: string | null }[],
): void {
  db.exec("BEGIN");
  try {
    for (const item of items) {
      const skin = getOrCreateSkin(item.name);
      recordPrice(skin.id, item.priceCents);
      if (item.iconUrl) {
        db.prepare("UPDATE skins SET icon_url = ? WHERE id = ?").run(item.iconUrl, skin.id);
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

// Every skin that has a picture ID saved.
export function getSkinIcons(): SkinIcon[] {
  return db.prepare("SELECT id, icon_url FROM skins WHERE icon_url IS NOT NULL").all() as SkinIcon[];
}

// What the web page shows for each skin: its first and latest price.
export type SkinSummary = {
  id: number;
  name: string;
  firstCents: number;
  latestCents: number;
  changeCents: number; // latest minus first
  changePercent: number; // the same change as a percentage of the first price
  checks: number; // how many prices we've saved for this skin
  firstCheckedAt: string;
  lastCheckedAt: string;
};

// Get one summary per skin. Each "(SELECT ...)" inside looks up one value
// from that skin's prices, e.g. the oldest one or the newest one.
export function getSkinSummaries(): SkinSummary[] {
  const rows = db
    .prepare(
      `SELECT
         s.id AS id,
         s.market_hash_name AS name,
         (SELECT price_cents FROM prices WHERE skin_id = s.id
            ORDER BY recorded_at, id LIMIT 1)            AS firstCents,
         (SELECT price_cents FROM prices WHERE skin_id = s.id
            ORDER BY recorded_at DESC, id DESC LIMIT 1)  AS latestCents,
         (SELECT COUNT(*)         FROM prices WHERE skin_id = s.id) AS checks,
         (SELECT MIN(recorded_at) FROM prices WHERE skin_id = s.id) AS firstCheckedAt,
         (SELECT MAX(recorded_at) FROM prices WHERE skin_id = s.id) AS lastCheckedAt
       FROM skins s
       WHERE EXISTS (SELECT 1 FROM prices WHERE skin_id = s.id)
       ORDER BY s.market_hash_name`,
    )
    .all() as Omit<SkinSummary, "changeCents" | "changePercent">[];

  return rows.map((row) => {
    const changeCents = row.latestCents - row.firstCents;
    return { ...row, changeCents, changePercent: (changeCents / row.firstCents) * 100 };
  });
}

// Is the program with this process ID (pid) still running?
// process.kill(pid, 0) doesn't stop anything; it only checks the program exists.
function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means it exists but belongs to another user, so it's still running.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

// Try to claim the update lock. Returns true if we got it, false if another
// update is already running (in this program or another one, like npm start).
// The lock lives in the database because that's the one thing the web server
// and npm start share.
export function tryLockUpdates(): boolean {
  // "IMMEDIATE" makes other programs wait until we're done checking and
  // claiming, so two programs can't both see "no lock" at the same moment.
  db.exec("BEGIN IMMEDIATE");
  try {
    const lock = db.prepare("SELECT pid FROM update_lock WHERE id = 1").get() as
      | { pid: number }
      | undefined;

    // A lock from a program that has stopped (say it crashed, or you pressed
    // Ctrl+C mid-update) is left over, so it's safe to take over.
    if (lock && isProcessRunning(lock.pid)) {
      db.exec("COMMIT");
      return false;
    }

    db.prepare(
      "INSERT OR REPLACE INTO update_lock (id, pid, started_at) VALUES (1, ?, datetime('now'))",
    ).run(process.pid);
    db.exec("COMMIT");
    return true;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

// Give the lock back so the next update can run.
export function unlockUpdates(): void {
  db.prepare("DELETE FROM update_lock WHERE id = 1 AND pid = ?").run(process.pid);
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
