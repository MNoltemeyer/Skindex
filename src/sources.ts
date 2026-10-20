// Every place we get prices from. The key ("steam") is what's saved in the
// "source" column of the prices table. To add a source later, add an entry
// here and write the code that fetches its prices.
export const SOURCES = {
  steam: {
    name: "Steam Community Market",
    // The page for one skin on this source's website.
    itemUrl: (marketHashName: string) =>
      `https://steamcommunity.com/market/listings/730/${encodeURIComponent(marketHashName)}`,
  },
};

// "steam" (and later, any other key added above).
export type SourceId = keyof typeof SOURCES;

// The source the web page shows. Steam is the only one for now.
export const MAIN_SOURCE: SourceId = "steam";
