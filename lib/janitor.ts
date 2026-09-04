import { readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { Database } from "better-sqlite3";
import { listSongs } from "@/lib/db";
import { getStorageDir } from "@/lib/storage";

export async function cleanupOrphanAudio(
  db: Database,
  opts?: { storageDir?: string }
): Promise<number> {
  const storageDir = opts?.storageDir ?? getStorageDir();
  const audioDir = join(storageDir, "audio");
  const known = new Set(listSongs(db, 100000).map((s) => s.id));
  let removed = 0;
  let entries: string[];
  try {
    entries = await readdir(audioDir);
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (!entry.endsWith(".mp3")) continue;
    const id = entry.slice(0, -4);
    if (known.has(id)) continue;
    try {
      await unlink(join(audioDir, entry));
      removed++;
      console.log(`[janitor] removed orphaned audio: ${entry}`);
    } catch (err) {
      console.error(`[janitor] failed to remove ${entry}:`, err);
    }
  }
  return removed;
}