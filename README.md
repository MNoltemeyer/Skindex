# Skindex

A local price tracker for Counter-Strike 2 skins, styled like a stock-trading app.

Skindex tracks every **AK-47 skin in Field-Tested condition** (not StatTrak or Souvenir) on the Steam Community Market. It saves the cheapest listing's price every 10 minutes to a local SQLite database, then shows the prices on a web page:

- **The collection total:** what it would cost to buy the cheapest Field-Tested listing of every AK-47 skin, and how much that has changed since the first check.
- **A list of every skin** with its picture, current price, and change since the first check in green or red. You can search it and sort it by name, price, or percentage change, in either direction.
- **A detail page for each skin** with a price chart (1 day, 1 week, all time), the number of listings, the lowest and highest prices seen, and a link to the skin on the Steam Market.

Everything the page shows comes from the local database, and skin pictures are saved to disk. If Steam is down or there's no internet, the page keeps showing the saved prices and says when it will try again.

## Requirements

- Node.js 24 or newer. It has SQLite built in, so there's no database to install.

## Running it

```sh
npm install     # install dependencies (first time only)
npm run web     # start the web server
```

Then open **http://localhost:3000** in your browser. The server fetches prices as soon as it starts, then again every 10 minutes. The page refreshes itself every minute. Press `Ctrl+C` in the terminal to stop the server.

The first update takes about 30 seconds, because Steam returns 10 skins per request and Skindex waits 5 seconds between requests so Steam doesn't block it.

Other commands:

```sh
npm start          # run one price update in the terminal, then exit
npm run typecheck  # check the code for type errors
npm run build      # compile the TypeScript to JavaScript in dist/
```

Only one update runs at a time. If the web server is already updating, `npm start` says so and exits.

## How it works

```
Steam Market search ──> src/steam.ts ──> src/update.ts ──> SQLite (data/skins.db)
                                              │                    │
                         src/images.ts <──────┘                    v
                     (pictures in data/images)          src/server.ts ──> public/ (web page)
```

| File | What it does |
|------|--------------|
| `src/steam.ts` | Asks Steam's market search for every Field-Tested AK-47, one page of 10 at a time. Waits and retries if Steam says it's going too fast, and gives up on requests that take longer than 30 seconds. |
| `src/update.ts` | One full update: fetch the prices, save them, download any missing pictures. `npm start` and the server's timer both use it. |
| `src/autoUpdate.ts` | The server's 10-minute timer. A failed update is logged and retried next time, and the server keeps running. |
| `src/db.ts` | The SQLite database: tables, upgrades (migrations), saving prices, and the queries the pages use. A lock stops two updates from running at once. |
| `src/sources.ts` | The list of price sources. Steam is the only one so far. |
| `src/images.ts` | Downloads each skin's picture once and saves it in `data/images/`. |
| `src/server.ts` | The web server. It serves the pages and a small JSON API: `/api/skins` and `/api/skins/:id`. |
| `public/` | The web pages: `index.html` is the list, `skin.html` is the detail page, and `common.js` and `style.css` are shared by both. Plain HTML, CSS and JavaScript, no framework. |

The database has two main tables:

- **`skins`:** one row per skin, with its name, picture ID, type and rarity color.
- **`prices`:** one row every time a skin's price is checked, with the price in cents, the number of listings, the time, and the **source** the price came from.

Storing the source with each price means another marketplace can be added without changing the tables.

## What I'd add next

- **CSFloat prices.** The database already stores a source with every price, so this means writing a fetcher for CSFloat and adding it to `src/sources.ts`. Then the detail page could compare Steam and CSFloat prices side by side.
- **Float values.** Field-Tested covers floats from 0.15 to 0.38, and a low float can be worth much more. Tracking the float of the cheapest listings would show what you actually get for the price.
- **More weapons and conditions.** Let the user pick which weapons and conditions to track, not just Field-Tested AK-47s.
- **Price alerts.** A notification when a skin drops below a target price.
- **Tests.** Automated tests for the database queries and the Steam response parsing.
