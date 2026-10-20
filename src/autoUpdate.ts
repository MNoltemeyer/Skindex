import { runUpdate } from "./update.js";

// How often the web server updates prices: 10 minutes, written in milliseconds.
const TEN_MINUTES_MS = 10 * 60 * 1000;

// What the timer is doing right now. The web page shows this.
let updating = false;
let nextUpdateAt: Date | null = null;
let lastError: string | null = null;

// Print a message with the time in front, like "[10:42:01 PM] Updating prices..."
function log(message: string): void {
  console.log(`[${new Date().toLocaleTimeString()}] ${message}`);
}

// Run one update. This function never throws: if anything goes wrong it logs
// the error and returns, so the server keeps running and the timer tries again.
async function updateNow(): Promise<void> {
  // The previous update is still going (Steam can be slow if it makes us wait).
  if (updating) {
    log("Skipping this update: the previous one is still running.");
    return;
  }

  updating = true;
  log("Updating prices...");
  try {
    const result = await runUpdate();
    if (result === null) {
      log("Skipping this update: another program (maybe npm start) is already updating.");
    } else {
      lastError = null;
      log(`Update finished: saved ${result.saved} prices in ${result.seconds}s.`);
    }
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    log(`Update failed: ${lastError}`);
    log("Will try again at the next update.");
  } finally {
    updating = false;
  }
}

// Start the timer: one update right now, then one every `everyMs` milliseconds.
export function startAutoUpdates(everyMs = TEN_MINUTES_MS): void {
  log(`Prices will update now, then every ${everyMs / 60_000} minutes.`);

  // "void" means: start this, but don't wait for it to finish. The server can
  // answer the web page while the update runs in the background.
  void updateNow();
  nextUpdateAt = new Date(Date.now() + everyMs);

  setInterval(() => {
    nextUpdateAt = new Date(Date.now() + everyMs);
    void updateNow();
  }, everyMs);
}

// A snapshot of the timer's state, for the web page.
export function getUpdaterStatus() {
  return {
    updating,
    nextUpdateAt: nextUpdateAt?.toISOString() ?? null,
    lastError,
  };
}
