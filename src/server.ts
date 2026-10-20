import { createServer, type ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { getUpdaterStatus, startAutoUpdates } from "./autoUpdate.js";
import { getPriceHistory, getSkin, getSkinSummaries } from "./db.js";
import { imagePath } from "./images.js";
import { MAIN_SOURCE, SOURCES } from "./sources.js";

const PORT = Number(process.env.PORT ?? 3000);
const HOST = "127.0.0.1"; // only this computer can open the page, not others on your network

// The "public" folder sits next to "src", one level up from this file.
const PUBLIC_DIR = new URL("../public/", import.meta.url);

// The only files the server will hand out. Listing them by name means nobody
// can ask for some other file on your computer.
const files: Record<string, { file: string; type: string }> = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/style.css": { file: "style.css", type: "text/css; charset=utf-8" },
  "/common.js": { file: "common.js", type: "text/javascript; charset=utf-8" },
  "/logo.svg": { file: "logo.svg", type: "image/svg+xml" },
};

// The address of a skin's picture, or null if we haven't downloaded it.
function imageUrl(skinId: number): string | null {
  return existsSync(imagePath(skinId)) ? `/images/${skinId}.png` : null;
}

function sendJson(response: ServerResponse, status: number, data: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(data));
}

async function sendPublicFile(response: ServerResponse, file: string, type: string): Promise<void> {
  const content = await readFile(new URL(file, PUBLIC_DIR));
  response.writeHead(200, { "Content-Type": type });
  response.end(content);
}

function sendNotFound(response: ServerResponse): void {
  response.writeHead(404, { "Content-Type": "text/plain" });
  response.end("Not found");
}

// This function runs once for every request the browser makes.
const server = createServer(async (request, response) => {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;

  try {
    // Data for the list page: one summary per skin.
    if (path === "/api/skins") {
      const skins = getSkinSummaries(MAIN_SOURCE).map((skin) => ({
        ...skin,
        image: imageUrl(skin.id),
      }));
      sendJson(response, 200, { skins, updater: getUpdaterStatus() });
      return;
    }

    // Data for one skin's detail page, like /api/skins/7. The pattern only
    // allows digits, so the id is always a plain number.
    const apiSkin = path.match(/^\/api\/skins\/(\d+)$/);
    if (apiSkin) {
      const skin = getSkin(Number(apiSkin[1]));
      if (!skin) {
        sendJson(response, 404, { error: "No skin with that id" });
        return;
      }
      const source = SOURCES[MAIN_SOURCE];
      sendJson(response, 200, {
        skin: {
          id: skin.id,
          name: skin.name,
          image: imageUrl(skin.id),
          itemType: skin.itemType,
          rarityColor: skin.rarityColor,
        },
        source: { id: MAIN_SOURCE, name: source.name, itemUrl: source.itemUrl(skin.name) },
        history: getPriceHistory(skin.id, MAIN_SOURCE),
        updater: getUpdaterStatus(),
      });
      return;
    }

    // A skin's detail page, like /skin/7. It's the same file for every skin;
    // the page reads the id from its own address and asks for that skin's data.
    if (/^\/skin\/\d+$/.test(path)) {
      await sendPublicFile(response, "skin.html", "text/html; charset=utf-8");
      return;
    }

    // Skin pictures, like /images/7.png.
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
      await sendPublicFile(response, match.file, match.type);
      return;
    }

    sendNotFound(response);
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
