import { getOrCreateSkin, getPriceHistory, recordPrice } from "./db.js";

// Turn 1234 cents into "$12.34".
function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// A quick demo: save a made-up price, then print the history.
// Later you'll replace the made-up price with a real one from a market API.
const skin = getOrCreateSkin("AK-47 | Redline (Field-Tested)");
recordPrice(skin.id, 1234);

console.log(`Price history for ${skin.market_hash_name}:`);
for (const entry of getPriceHistory(skin.id)) {
  console.log(`  ${entry.recorded_at}  ${formatPrice(entry.price_cents)}`);
}
