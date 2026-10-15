import { existsSync, mkdirSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import type { SkinIcon } from "./db.js";

// Pictures are saved here, one file per skin, named after the skin's id: "7.png".
export const IMAGES_DIR = "data/images";

// Steam's image server. 128fx128f asks for a picture that fits in 128×128 pixels.
const IMAGE_URL = "https://community.fastly.steamstatic.com/economy/image";
const IMAGE_SIZE = "128fx128f";

// A short pause between downloads, to be polite to Steam's servers.
const DELAY_BETWEEN_DOWNLOADS_MS = 200;

export function imagePath(skinId: number): string {
  return `${IMAGES_DIR}/${skinId}.png`;
}

// Download the picture for every skin that doesn't have one saved yet.
// Pictures we already have are skipped, so after the first run this is quick.
export async function downloadMissingImages(skins: SkinIcon[]) {
  mkdirSync(IMAGES_DIR, { recursive: true });
  const missing = skins.filter((skin) => !existsSync(imagePath(skin.id)));
  let downloaded = 0;
  let failed = 0;

  for (const skin of missing) {
    if (downloaded + failed > 0) {
      await sleep(DELAY_BETWEEN_DOWNLOADS_MS);
    }

    try {
      const response = await fetch(`${IMAGE_URL}/${skin.icon_url}/${IMAGE_SIZE}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const bytes = Buffer.from(await response.arrayBuffer());

      // Save to a temporary name first, then rename. That way a download that
      // stops halfway never leaves a broken picture behind.
      const path = imagePath(skin.id);
      await writeFile(`${path}.tmp`, bytes);
      await rename(`${path}.tmp`, path);
      downloaded++;
    } catch (error) {
      console.warn(`  Couldn't download picture for skin ${skin.id}: ${(error as Error).message}`);
      failed++;
    }
  }

  return { downloaded, failed, alreadyHad: skins.length - missing.length };
}
