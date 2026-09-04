import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { listPendingSongs, markReady, markFailed } from "@/lib/db";
import { getDb } from "@/lib/app-db";
import { createAceStepClient } from "@/lib/acestep-client";
import type { Database } from "better-sqlite3";
import type { AceStepClient } from "@/lib/acestep-client";

let started = false;
let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
const failureCounts = new Map<string, number>();
const MAX_FAILURES = 3;
const POLL_INTERVAL_MS = 2000;
const DEFAULT_PENDING_TIMEOUT_MS = 30 * 60 * 1000;

export interface PollerOptions {
  storageDir: string;
  pendingTimeoutMs?: number;
}

export async function pollOnce(
  db: Database,
  client: AceStepClient,
  opts: PollerOptions
): Promise<void> {
  const pendingTimeoutMs = opts.pendingTimeoutMs ?? DEFAULT_PENDING_TIMEOUT_MS;

  const initiallyPending = listPendingSongs(db);
  if (initiallyPending.length === 0) return;

  for (const [id] of failureCounts) {
    if (!initiallyPending.some((s) => s.id === id)) failureCounts.delete(id);
  }

  const expired = initiallyPending.filter((s) => Date.now() - s.createdAt > pendingTimeoutMs);
  let anyReady = false;
  for (const song of expired) {
    markFailed(db, song.id, "Generation timed out — ACE-Step never finished this task");
  }

  const pending = initiallyPending.filter((s) => !expired.some((e) => e.id === s.id));
  if (pending.length === 0) return;

  const taskIds = pending.map((s) => s.taskId);
  let results;
  try {
    results = await client.queryResults(taskIds);
  } catch (err) {
    console.error("[poller] queryResults failed:", err);
    return; // transient — do not penalize songs
  }

  const byTaskId = new Map(results.map((r) => [r.taskId, r]));
  for (const song of pending) {
    const r = byTaskId.get(song.taskId);
    if (!r) continue;
    if (r.status === 1) {
      if (!r.file) {
        markFailed(db, song.id, "ACE-Step returned success without an audio file");
        continue;
      }
      const audioDir = join(opts.storageDir, "audio");
      await mkdir(audioDir, { recursive: true });
      const relPath = `audio/${song.id}.mp3`;
      const absPath = join(opts.storageDir, relPath);
      try {
        const buf = await client.downloadAudio(r.file);
        await writeFile(absPath, Buffer.from(buf));
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
      const marked = markReady(db, song.id, {
        audioPath: relPath,
        metas: r.metas ?? {},
        seedValue: r.seed_value ?? "",
        ditModel: r.dit_model ?? "",
        lmModel: r.lm_model ?? "",
      });
      if (marked) anyReady = true;
      console.log(`[poller] ${marked ? "marked ready" : "skipped (already terminal)"}: ${song.id}`);
    } else if (r.status === 2) {
      markFailed(db, song.id, r.error ?? "ACE-Step task failed (no error message)");
    }
  }

  if (anyReady) {
    try { db.pragma("wal_checkpoint(TRUNCATE)"); } catch { /* best-effort */ }
  }
}

export function startPoller(opts?: {
  client?: AceStepClient;
  db?: Database;
  storageDir?: string;
}): void {
  if (started) return;
  started = true;
  const baseUrl = process.env.ACESTEP_API_URL ?? "http://localhost:8001";
  const apiKey = process.env.ACESTEP_API_KEY || undefined;
  const db = opts?.db ?? getDb();
  const client = opts?.client ?? createAceStepClient({ baseUrl, apiKey });
  const storageDir = opts?.storageDir ?? join(process.cwd(), "storage");

  async function loop() {
    try {
      await pollOnce(db, client, { storageDir });
    } catch (err) {
      console.error("[poller] pollOnce error:", err);
    }
    if (started) timeoutHandle = setTimeout(loop, POLL_INTERVAL_MS);
  }
  timeoutHandle = setTimeout(loop, 0);
}

export function stopPoller(): void {
  started = false;
  if (timeoutHandle) clearTimeout(timeoutHandle);
  timeoutHandle = null;
}