import { setTimeout as sleep } from "node:timers/promises";

const SEARCH_URL = "https://steamcommunity.com/market/search/render/";

// Steam returns at most 10 items per page for this request, no matter what
// "count" we ask for, so we ask for 10 and move forward 10 at a time.
const PAGE_SIZE = 10;

// How long to wait between pages, so Steam doesn't block us for asking too fast.
const DELAY_BETWEEN_PAGES_MS = 5_000;

// If Steam does block us (HTTP 429 "Too Many Requests"), wait this long and retry.
const RATE_LIMIT_WAIT_MS = 60_000;
const MAX_ATTEMPTS = 3;

// One item in Steam's search results (only the fields we use).
export type MarketItem = {
  hash_name: string; // unique name, e.g. "AK-47 | Redline (Field-Tested)"
  sell_listings: number; // how many are listed for sale right now
  sell_price: number; // cheapest listing, in US cents
  sell_price_text: string; // the same price as text, e.g. "$12.34"
};

// The whole response for one page.
type SearchResponse = {
  success: boolean;
  start: number;
  pagesize: number;
  total_count: number; // how many items match the search in total
  results: MarketItem[];
};

// Ask Steam for one page of results, starting at item number `start`.
async function fetchSearchPage(start: number): Promise<SearchResponse> {
  const params = new URLSearchParams({
    appid: "730", // 730 is CS2's game ID on Steam
    norender: "1", // give us JSON data instead of HTML
    start: String(start),
    count: String(PAGE_SIZE),
    sort_column: "name", // a fixed order, so pages don't overlap or skip items
    sort_dir: "asc",
    search_descriptions: "0",
    "category_730_Weapon[]": "tag_weapon_ak47", // only AK-47s
    "category_730_Exterior[]": "tag_WearCategory2", // only Field-Tested
    "category_730_Quality[]": "tag_normal", // no StatTrak or Souvenir
  });
  const url = `${SEARCH_URL}?${params}`;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await fetch(url);

    if (response.status === 429) {
      console.log(`  Steam says we're going too fast. Waiting ${RATE_LIMIT_WAIT_MS / 1000}s...`);
      await sleep(RATE_LIMIT_WAIT_MS);
      continue;
    }
    if (!response.ok) {
      throw new Error(`Steam returned HTTP ${response.status} for start=${start}`);
    }

    const data = (await response.json()) as SearchResponse;
    if (!data.success) {
      throw new Error(`Steam reported an unsuccessful search for start=${start}`);
    }
    return data;
  }

  throw new Error(`Gave up on start=${start} after ${MAX_ATTEMPTS} attempts`);
}

// Fetch every page and return all the items together.
export async function fetchAllFieldTestedAKs(): Promise<MarketItem[]> {
  const items: MarketItem[] = [];
  let start = 0;
  let total = 1; // updated from Steam's answer on the first page

  while (start < total) {
    if (start > 0) {
      await sleep(DELAY_BETWEEN_PAGES_MS);
    }

    const page = await fetchSearchPage(start);
    total = page.total_count;
    console.log(`  Got items ${start + 1}-${start + page.results.length} of ${total}`);

    if (page.results.length === 0) {
      break; // nothing more to read, so stop instead of looping forever
    }
    items.push(...page.results);
    start += page.results.length;
  }

  return items;
}
