import { getSkinIcons, recordPrices, tryLockUpdates, unlockUpdates } from "./db.js";
import { downloadMissingImages, type ImageDownloadResult } from "./images.js";
import { fetchAllFieldTestedAKs } from "./steam.js";

export type UpdateResult = {
  saved: number; // how many prices were saved
  seconds: number; // how long the update took
  images: ImageDownloadResult;
};

// Turn 1234 cents into "$12.34".
function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// One full price update. Both `npm start` and the web server's timer call this.
// Returns null (and does nothing) if another update is already running.
// If something goes wrong, it throws an error for the caller to handle.
export async function runUpdate(): Promise<UpdateResult | null> {
  if (!tryLockUpdates()) {
    return null;
  }

  // "finally" runs whether the update succeeds or throws an error,
  // so the lock is always given back.
  try {
    const startedAt = Date.now();
    console.log("Fetching Field-Tested AK-47 prices from the Steam Community Market...");

    const items = await fetchAllFieldTestedAKs();

    // A skin with nothing for sale has no price, so skip it instead of saving $0.00.
    const forSale = items.filter((item) => item.sell_listings > 0 && item.sell_price > 0);
    recordPrices(
      forSale.map((item) => ({
        name: item.hash_name,
        priceCents: item.sell_price,
        iconUrl: item.asset_description?.icon_url ?? null,
      })),
    );

    const seconds = Number(((Date.now() - startedAt) / 1000).toFixed(1));
    console.log(`\nSaved prices for ${forSale.length} skins in ${seconds}s.`);
    if (forSale.length < items.length) {
      console.log(`Skipped ${items.length - forSale.length} with no listings.`);
    }

    // Show the cheapest and most expensive, as a quick check that the data looks right.
    const byPrice = [...forSale].sort((a, b) => a.sell_price - b.sell_price);
    const cheapest = byPrice[0];
    const priciest = byPrice[byPrice.length - 1];
    if (cheapest && priciest) {
      console.log(`Cheapest:       ${cheapest.hash_name}  ${formatPrice(cheapest.sell_price)}`);
      console.log(`Most expensive: ${priciest.hash_name}  ${formatPrice(priciest.sell_price)}`);
    }

    // Prices are already saved at this point, so a failed picture download
    // never loses price data.
    console.log("\nChecking skin pictures...");
    const images = await downloadMissingImages(getSkinIcons());
    console.log(
      `Pictures: ${images.downloaded} downloaded, ${images.alreadyHad} already saved` +
        (images.failed > 0 ? `, ${images.failed} failed (will retry next run)` : ""),
    );

    return { saved: forSale.length, seconds, images };
  } finally {
    unlockUpdates();
  }
}
