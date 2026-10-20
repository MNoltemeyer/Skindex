// Helpers shared by every Skindex page.

// How often pages ask the server for fresh data: 1 minute.
const REFRESH_EVERY_MS = 60 * 1000;

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

// Turn cents into "$12.34".
function formatMoney(cents) {
  return money.format(cents / 100);
}

// Turn a change into "+$1.20 (+3.45%)", and pick a color class for it.
function formatChange(cents, percent) {
  const sign = cents > 0 ? "+" : cents < 0 ? "−" : "";
  const text = `${sign}${formatMoney(Math.abs(cents))} (${sign}${Math.abs(percent).toFixed(2)}%)`;
  const color = cents > 0 ? "up" : cents < 0 ? "down" : "flat";
  return { text, color };
}

// SQLite saves times like "2026-10-15 02:14:17" in UTC. Turn that into a Date.
function parseSqliteTime(sqliteTime) {
  return new Date(sqliteTime.replace(" ", "T") + "Z");
}

// Show a SQLite time in your local time, like "Oct 20, 2026, 1:08 AM".
function formatTime(sqliteTime) {
  return parseSqliteTime(sqliteTime).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

// "just now", "3 min ago", "2 hr ago", "4 days ago"
function timeAgo(date) {
  const minutes = Math.floor((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

// "in 7 min", or "in less than a minute"
function timeUntil(date) {
  const minutes = Math.ceil((date.getTime() - Date.now()) / 60000);
  return minutes <= 1 ? "in less than a minute" : `in ${minutes} min`;
}

// Split "AK-47 | Redline (Field-Tested)" into its parts.
function splitName(fullName) {
  const match = fullName.match(/^(.+?) \| (.+) \((.+)\)$/);
  return match ? { weapon: match[1], skin: match[2], wear: match[3] } : { weapon: "", skin: fullName, wear: "" };
}

// Make text safe to put into HTML (so a name can't break the page).
function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

// The picture for an oval thumbnail. If there's no picture, or it fails to
// load, show the skin's first letter instead.
function thumbnail(image, skinName) {
  const letter = escapeHtml(skinName.charAt(0));
  if (!image) return letter;
  return `<img src="${image}" alt="" loading="lazy" data-letter="${letter}" onerror="this.replaceWith(this.dataset.letter)">`;
}

// The status line: when prices were last updated, and what the server's
// timer is doing. Needs elements with ids "status" and "status-text".
// `lastCheckedAt` is a SQLite time (or null); `offline` means the last
// refresh couldn't reach the server.
function renderStatus(lastCheckedAt, updater, offline) {
  const parts = [];
  let state = "";

  if (lastCheckedAt) {
    parts.push(`Prices updated ${formatTime(lastCheckedAt)} (${timeAgo(parseSqliteTime(lastCheckedAt))})`);
  }

  if (offline) {
    state = "error";
    parts.push("Can't reach the Skindex server, retrying every minute");
  } else if (updater?.updating) {
    state = "updating";
    parts.push("Updating now…");
  } else if (updater?.lastError) {
    state = "error";
    parts.push(`Last update failed (${updater.lastError}), will retry ${updater.nextUpdateAt ? timeUntil(new Date(updater.nextUpdateAt)) : "soon"}`);
  } else if (updater?.nextUpdateAt) {
    parts.push(`Next update ${timeUntil(new Date(updater.nextUpdateAt))}`);
  }

  const status = document.getElementById("status");
  status.hidden = parts.length === 0;
  status.className = `status ${state}`;
  document.getElementById("status-text").textContent = parts.join(" · ");
}
