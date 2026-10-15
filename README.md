# CS2 Skin Price Tracker

Tracks prices of Counter-Strike 2 skins over time, stored in a local SQLite database.

## Requirements

- Node.js 24 or newer (it includes SQLite, so there's nothing extra to install)

## Getting started

```sh
npm install      # install dependencies
npm start        # run the app once
npm run dev      # run the app and restart it whenever you save a file
npm run build    # compile TypeScript to JavaScript in dist/
npm run typecheck  # check for type errors without building
```

The database is saved to `data/skins.db`.
