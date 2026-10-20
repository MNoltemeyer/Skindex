import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { getUpdaterStatus, startAutoUpdates } from "./autoUpdate.js";
import { getSkinSummaries } from "./db.js";
import { imagePath } from "./images.js";

const PORT = Number(process.env.PORT ?? 3000);
const HOST = "127.0.0.1"; // only this computer can open the page, not others on your network

// The "public" folder sits next to "src", one level up from this file.
const PUBLIC_DIR = new URL("../public/", import.meta.url);

// The only files the server will hand out. Listing them by name means nobody
// can ask for some other file on your computer.
const files: Record<string, { file: string; type: string }> = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/logo.svg": { file: "logo.svg", type: "image/svg+xml" },
};

// This function runs once for every request the browser makes.
const server = createServer(async (request, response) => {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;

  try {
    // The page asks this address for the data, then draws it.
    if (path === "/api/skins") {
      // Tell the page where each skin's picture is, or null if we haven't downloaded it.
      const skins = getSkinSummaries().map((skin) => ({
        ...skin,
        image: existsSync(imagePath(skin.id)) ? `/images/${skin.id}.png` : null,
      }));
      response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ skins, updater: getUpdaterStatus() }));
      return;
    }

    // Skin pictures, like /images/7.png. The pattern only allows digits, so
    // this can only ever read files from the pictures folder.
    const image = path.match(/^\/images\/(\d+)\.png$/);
    if (image && existsSync(imagePath(Number(image[1])))) {
      const content = await readFile(imagePath(Number(image[1])));
      // Pictures rarely change, so the browser may reuse them for a day.
      response.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "max-age=86400" });
      response.end(content);
      return;
    }

    const match = files[path];
    if (match) {
      const content = await readFile(new URL(match.file, PUBLIC_DIR));
      response.writeHead(200, { "Content-Type": match.type });
      response.end(content);
      return;
    }

    response.writeHead(404, { "Content-Type": "text/plain" });
    response.end("Not found");
  } catch (error) {
    console.error(error);
    response.writeHead(500, { "Content-Type": "text/plain" });
    response.end("Something went wrong. Check the terminal for details.");
  }
});

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Is Skindex already running in another terminal?`);
  } else {
    console.error(error);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`Skindex is running at http://localhost:${PORT}`);
  console.log("Press Ctrl+C to stop it.");

  // Only start updating once the server is up. If the port was taken, the
  // "error" handler above stops the program before we get here.
  startAutoUpdates();
});
