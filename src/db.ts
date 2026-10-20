import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import type { SourceId } from "./sources.js";

// Make sure the "data" folder exists, then open (or create) the database file.
mkdirSync("data", { recursive: true });
export const db = new DatabaseSync("data/skins.db");

// "WAL" mode lets the web page read the database while the tracker is
// saving new prices, without either one having to wait for the other.
db.exec("PRAGMA journal_mode = WAL");

// If the database is busy for a moment (another program is saving), wait up
// to 5 seconds for it instead of failing straight away.
db.exec("PRAGMA busy_timeout = 5000");

// ---------------------------------------------------------------------------
// Migrations: numbered upgrades to the database's structure.
//
// SQLite keeps a number inside every database file called "user_version".
// It starts at 0. Each time the program starts, it runs every migration whose
// number is higher than the database's user_version, in order, and then sets
// user_version to that number. So each migration runs exactly once per
// database, and to change the structure later you add a new migration at the
// end of the list (never edit one that has already run).
// ---------------------------------------------------------------------------

function hasColumn(table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return columns.some((c) => c.name === column);
}

const migrations: { version: number; description: string; run: () => void }[] = [
  {
    version: 1,
    description: "create the skins, prices and update_lock tables",
    run() {
      db.exec(`
        CREATE TABLE IF NOT EXISTS skins (
          id               INTEGER PRIMARY KEY AUTOINCREMENT,
          market_hash_name TEXT NOT NULL UNIQUE  -- e.g. "AK-47 | Redline (Field-Tested)"
        );

        CREATE TABLE IF NOT EXISTS prices (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          skin_id     INTEGER NOT NULL REFERENCES skins(id),
          price_cents INTEGER NOT NULL,          -- money as whole cents, to avoid rounding errors
          currency    TEXT NOT NULL DEFAULT 'USD',
          recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- At most one row (id must be 1). If the row exists, an update is
        -- running, and pid says which program is running it.
        CREATE TABLE IF NOT EXISTS update_lock (
          id         INTEGER PRIMARY KEY CHECK (id = 1),
          pid        INTEGER NOT NULL,
          started_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
      // Steam's ID for the skin's picture. Databases made before pictures
      // were added may already have this column, so only add it if missing.
      if (!hasColumn("skins", "icon_url")) {
        db.exec("ALTER TABLE skins ADD COLUMN icon_url TEXT");
      }
    },
  },
  {
    version: 2,
    description: "store prices by source, save listings, skin type and rarity, add an index",
    run() {
      db.exec(`
        -- Where each price came from: 'steam' now, maybe 'csmoney' later.
        -- Every price saved before this column existed came from Steam.
        ALTER TABLE prices ADD COLUMN source TEXT NOT NULL DEFAULT 'steam';

        -- How many were for sale when we checked. Empty for older prices
        -- (we didn't save it then) and for sources that don't report it.
        ALTER TABLE prices ADD COLUMN listings INTEGER;

        -- Facts about the skin itself, from Steam: "Covert Rifle", "eb4b4b".
        ALTER TABLE skins ADD COLUMN item_type TEXT;
        ALTER TABLE skins ADD COLUMN rarity_color TEXT;

        -- Like the index at the back of a book: lets the database jump
        -- straight to one skin's prices from one source, already in time order.
        CREATE INDEX IF NOT EXISTS prices_by_skin_source_time
          ON prices (skin_id, source, recorded_at);
      `);
    },
  },
];

function getVersion(): number {
  return (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
}

function migrate(): void {
  const latest = migrations[migrations.length - 1]!.version;
  const startVersion = getVersion();
  if (startVersion >= latest) {
    return; // already up to date
  }

  // Before changing an existing database, save a copy. ("VACUUM INTO" writes
  // a clean, complete copy of the database to a new file.) A brand-new empty
  // database has no skins table yet, so there's nothing worth backing up.
  const hasData = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'skins'").get();
  if (hasData) {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
    const backup = `data/backup-v${startVersion}-${stamp}.db`;
    db.exec(`VACUUM INTO '${backup}'`);
    console.log(`Saved a backup of the database to ${backup}`);
  }

  for (const migration of migrations) {
    // Each migration runs inside a transaction: if any part of it fails,
    // none of it is kept, and the database stays as it was.
    db.exec("BEGIN IMMEDIATE");
    try {
      // Check the version again now that we hold the write lock, in case
      // another program (say npm start, starting at the same moment) just
      // ran this migration.
      if (getVersion() >= migration.version) {
        db.exec("COMMIT");
        continue;
      }
      migration.run();
      db.exec(`PRAGMA user_version = ${migration.version}`);
      db.exec("COMMIT");
      console.log(`Upgraded the database to version ${migration.version}: ${migration.description}`);
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}

migrate();

// ---------------------------------------------------------------------------
// Skins and prices
// ---------------------------------------------------------------------------

// TypeScript "types" describe the shape of our data.
export type Skin = {
  id: number;
  name: string;
  iconUrl: string | null;
  itemType: string | null; // e.g. "Covert Rifle"
  rarityColor: string | null; // e.g. "eb4b4b"
};

export type SkinIcon = {
  id: number;
  icon_url: string;
};

// One price reading to save. Everything except name and price is optional,
// because other sources may not provide it.
export type PriceToSave = {
  name: string;
  priceCents: number;
  listings: number | null;
  iconUrl: string | null;
  itemType: string | null;
  rarityColor: string | null;
};

// Add a skin if it isn't already saved, and return its id either way.
function getOrCreateSkinId(marketHashName: string): number {
  db.prepare("INSERT OR IGNORE INTO skins (market_hash_name) VALUES (?)").run(marketHashName);
  const row = db.prepare("SELECT id FROM skins WHERE market_hash_name = ?").get(marketHashName) as {
    id: number;
  };
  return row.id;
}

// Save a price for every skin in one go. A "transaction" means either all of
// them are saved, or (if something goes wrong halfway) none are.
export function recordPrices(source: SourceId, items: PriceToSave[]): void {
  const insertPrice = db.prepare(
    "INSERT INTO prices (skin_id, source, price_cents, listings) VALUES (?, ?, ?, ?)",
  );
  // COALESCE(new, old) keeps the old value when the new one is empty.
  const updateSkin = db.prepare(
    `UPDATE skins SET
       icon_url     = COALESCE(?, icon_url),
       item_type    = COALESCE(?, item_type),
       rarity_color = COALESCE(?, rarity_color)
     WHERE id = ?`,
  );

  db.exec("BEGIN");
  try {
    for (const item of items) {
      const skinId = getOrCreateSkinId(item.name);
      insertPrice.run(skinId, source, item.priceCents, item.listings);
      updateSkin.run(item.iconUrl, item.itemType, item.rarityColor, skinId);
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

// One skin by its id, or undefined if there's no such skin.
export function getSkin(id: number): Skin | undefined {
  return db
    .prepare(
      `SELECT id, market_hash_name AS name, icon_url AS iconUrl,
              item_type AS itemType, rarity_color AS rarityColor
       FROM skins WHERE id = ?`,
    )
    .get(id) as Skin | undefined;
}

// What the list page shows for each skin: its first and latest price.
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

// Get one summary per skin, using prices from one source only (so a Steam
// price is never compared with a price from somewhere else). Each
// "(SELECT ...)" inside looks up one value from that skin's prices.
export function getSkinSummaries(source: SourceId): SkinSummary[] {
  const rows = db
    .prepare(
      `SELECT
         s.id AS id,
         s.market_hash_name AS name,
         (SELECT price_cents FROM prices WHERE skin_id = s.id AND source = $source
            ORDER BY recorded_at, id LIMIT 1)            AS firstCents,
         (SELECT price_cents FROM prices WHERE skin_id = s.id AND source = $source
            ORDER BY recorded_at DESC, id DESC LIMIT 1)  AS latestCents,
         (SELECT COUNT(*)         FROM prices WHERE skin_id = s.id AND source = $source) AS checks,
         (SELECT MIN(recorded_at) FROM prices WHERE skin_id = s.id AND source = $source) AS firstCheckedAt,
         (SELECT MAX(recorded_at) FROM prices WHERE skin_id = s.id AND source = $source) AS lastCheckedAt
       FROM skins s
       WHERE EXISTS (SELECT 1 FROM prices WHERE skin_id = s.id AND source = $source)
       ORDER BY s.market_hash_name`,
    )
    .all({ source }) as Omit<SkinSummary, "changeCents" | "changePercent">[];

  return rows.map((row) => {
    const changeCents = row.latestCents - row.firstCents;
    return { ...row, changeCents, changePercent: (changeCents / row.firstCents) * 100 };
  });
}

export type PricePoint = {
  priceCents: number;
  listings: number | null;
  recordedAt: string;
};

// Every saved price for one skin from one source, oldest first.
export function getPriceHistory(skinId: number, source: SourceId): PricePoint[] {
  return db
    .prepare(
      `SELECT price_cents AS priceCents, listings, recorded_at AS recordedAt
       FROM prices WHERE skin_id = ? AND source = ?
       ORDER BY recorded_at, id`,
    )
    .all(skinId, source) as PricePoint[];
}

// ---------------------------------------------------------------------------
// The update lock: makes sure two updates never run at the same time
// ---------------------------------------------------------------------------

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
