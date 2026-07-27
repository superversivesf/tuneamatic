import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { initDb, listPendingSongs, markReady, markFailed } from "@/lib/db";
import { createAceStepClient } from "@/lib/acestep-client";
import type { Database } from "better-sqlite3";
import type { AceStepClient } from "@/lib/acestep-client";

let started = false;
let intervalHandle: ReturnType<typeof setInterval> | null = null;
const failureCounts = new Map<string, number>();
const MAX_FAILURES = 3;

export interface PollerOptions {
  storageDir: string;
}

export async function pollOnce(
  db: Database,
  client: AceStepClient,
  opts: PollerOptions
): Promise<void> {
  const pending = listPendingSongs(db);
  if (pending.length === 0) return;

  const taskIds = pending.map((s) => s.taskId);
  let results;
  try {
    results = await client.queryResults(taskIds);
  } catch (err) {
    for (const song of pending) {
      const count = (failureCounts.get(song.id) ?? 0) + 1;
      failureCounts.set(song.id, count);
      if (count >= MAX_FAILURES) {
        markFailed(db, song.id, `ACE-Step query failed repeatedly: ${(err as Error).message}`);
        failureCounts.delete(song.id);
      }
    }
    return;
  }

  for (const song of pending) {
    failureCounts.delete(song.id);
  }

  const byTaskId = new Map(results.map((r) => [r.taskId, r]));
  for (const song of pending) {
    const r = byTaskId.get(song.taskId);
    if (!r) continue;
    console.log(`[poller] song ${song.id} task ${song.taskId} status=${r.status}`);
    if (r.status === 1) {
      const audioDir = join(opts.storageDir, "audio");
      mkdirSync(audioDir, { recursive: true });
      const relPath = `audio/${song.id}.mp3`;
      const absPath = join(opts.storageDir, relPath);
      try {
        const buf = await client.downloadAudio(r.file!);
        writeFileSync(absPath, Buffer.from(buf));
        console.log(`[poller] downloaded ${buf.byteLength} bytes to ${absPath}`);
      } catch (err) {
        console.error(`[poller] audio download failed for ${song.id}:`, err);
        const count = (failureCounts.get(song.id) ?? 0) + 1;
        failureCounts.set(song.id, count);
        if (count >= MAX_FAILURES) {
          markFailed(db, song.id, `Audio download failed: ${(err as Error).message}`);
          failureCounts.delete(song.id);
        }
        continue;
      }
      markReady(db, song.id, {
        audioPath: relPath,
        metas: r.metas ?? {},
        seedValue: r.seed_value ?? "",
        ditModel: r.dit_model ?? "",
        lmModel: r.lm_model ?? "",
      });
    } else if (r.status === 2) {
      markFailed(db, song.id, r.error ?? "ACE-Step task failed (no error message)");
    }
  }
}

export function startPoller(): void {
  if (started) return;
  started = true;
  const baseUrl = process.env.ACESTEP_API_URL ?? "http://localhost:8001";
  const apiKey = process.env.ACESTEP_API_KEY || undefined;
  const storageDir = join(process.cwd(), "storage");
  const db = initDb(join(process.cwd(), "data", "tuneamatic.db"));
  const client = createAceStepClient({ baseUrl, apiKey });
  intervalHandle = setInterval(() => {
    pollOnce(db, client, { storageDir }).catch((err) => {
      console.error("[poller] pollOnce error:", err);
    });
  }, 2000);
}

export function stopPoller(): void {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
  started = false;
}