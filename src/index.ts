import { runUpdate } from "./update.js";

// `npm start` runs one price update and then stops.
const result = await runUpdate();

if (result === null) {
  console.log("Another update is already running (maybe the Skindex web server's timer).");
  console.log("Try again in a minute.");
  process.exitCode = 1;
}
