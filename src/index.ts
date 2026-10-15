import { getSkinIcons, recordPrices } from "./db.js";
import { downloadMissingImages } from "./images.js";
import { fetchAllFieldTestedAKs } from "./steam.js";

// Turn 1234 cents into "$12.34".
function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

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

const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
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
