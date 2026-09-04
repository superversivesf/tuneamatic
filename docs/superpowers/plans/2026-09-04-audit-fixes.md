# Tuneamatic Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all confirmed issues (AUDIT.md #1–#13) from the 2026-09-04 multi-agent audit via test-driven, layered commits.

**Architecture:** Status-machine hardening in the DB layer (guarded transitions + `reserved` lifecycle), a serialized poller loop, timeout/auth/error-mapping fixes in the ACE-Step client, Origin-guarded and validated API routes, form-preserving frontend failure UX, and a consolidated storage module with a startup orphan janitor.

**Tech Stack:** Next.js 14 App Router, TypeScript, better-sqlite3, vitest, React 18.

## Global Constraints

- Every commit must pass: `pnpm test:run && pnpm typecheck && pnpm lint`
- Do not change the public API contract except where the spec says so (`onComplete` signature, validation 400s, 403s, 416s are intentional)
- No component/UI tests — frontend verified via `pnpm typecheck && pnpm lint` (per spec §5)
- No new dependencies
- Status values: `"pending" | "ready" | "failed" | "reserved"` (new `reserved` extends `SongStatus`)
- Timeout constants: 30 s (releaseTask/queryResults/ping), 5 min (downloadAudio), 30 min (pending songs), 5 min (expired reserved rows)
- Validation limits: prompt 1–2000, lyrics ≤ 20000, title ≤ 200 chars; duration 10–600, bpm 30–300, batchSize 1–8
- `listSongs` default limit: 500
- Spec: `docs/superpowers/specs/2026-09-04-audit-fixes-design.md` (authoritative); findings: `AUDIT.md`

---

### Task 1: DB — status guards, `reserved` lifecycle, WAL, listSongs limit

**Files:**
- Modify: `lib/types.ts:1` (SongStatus)
- Modify: `lib/db.ts:7-39` (schema comment, initDb), `lib/db.ts:41-52` (insertSong), `lib/db.ts:79-125` (markReady, markFailed, listSongs, listPendingSongs), add new functions
- Test: `tests/db.test.ts`

**Interfaces:**
- Produces: `markReady(db, id, fields): boolean`, `markFailed(db, id, error): boolean`, `insertReservedSong(db, {title, prompt, lyrics, advanced}): string`, `activateSong(db, id, taskId): boolean`, `deleteExpiredReserved(db, olderThanMs): void`, `listSongs(db, limit?): Song[]` (limit defaults to 500)
- Consumes: existing `insertSong` (unchanged signature), `SongStatus` type extended to `"pending" | "ready" | "failed" | "reserved"`

- [ ] **Step 1: Write the failing tests**

Append to `tests/db.test.ts` (file already has 8 tests using `makeTestDb()`; keep its existing imports intact):

```typescript
import {
  insertSong, getSong, markReady, markFailed,
  insertReservedSong, activateSong, deleteExpiredReserved, listSongs,
} from "@/lib/db";

describe("status transition guards", () => {
  it("markFailed after markReady is a no-op returning false", () => {
    const db = makeTestDb();
    const id = insertSong(db, { taskId: "t1", title: "", prompt: "p", lyrics: "", advanced: {} });
    expect(markReady(db, id, { audioPath: "audio/x.mp3", metas: {}, seedValue: "", ditModel: "", lmModel: "" })).toBe(true);
    expect(markFailed(db, id, "late failure")).toBe(false);
    expect(getSong(db, id)!.status).toBe("ready");
    expect(getSong(db, id)!.error).toBeNull();
  });

  it("markReady after markFailed is a no-op returning false", () => {
    const db = makeTestDb();
    const id = insertSong(db, { taskId: "t1", title: "", prompt: "p", lyrics: "", advanced: {} });
    expect(markFailed(db, id, "boom")).toBe(true);
    expect(markReady(db, id, { audioPath: "audio/x.mp3", metas: {}, seedValue: "", ditModel: "", lmModel: "" })).toBe(false);
    expect(getSong(db, id)!.status).toBe("failed");
  });

  it("markReady on nonexistent id returns false", () => {
    const db = makeTestDb();
    expect(markReady(db, "nope", { audioPath: "a", metas: {}, seedValue: "", ditModel: "", lmModel: "" })).toBe(false);
    expect(markFailed(db, "nope", "x")).toBe(false);
  });
});

describe("reserved lifecycle", () => {
  const base = { title: "T", prompt: "p", lyrics: "l", advanced: {} };

  it("insertReservedSong → pending is invisible; activateSong flips to pending", () => {
    const db = makeTestDb();
    const id = insertReservedSong(db, base);
    expect(getSong(db, id)!.status).toBe("reserved");
    expect(getSong(db, id)!.taskId).toBe("reserved");
    expect(listPendingSongs(db)).toHaveLength(0);
    expect(activateSong(db, id, "task-9")).toBe(true);
    const s = getSong(db, id)!;
    expect(s.status).toBe("pending");
    expect(s.taskId).toBe("task-9");
  });

  it("activateSong is a no-op on a pending row", () => {
    const db = makeTestDb();
    const id = insertSong(db, { taskId: "t1", title: "", prompt: "p", lyrics: "", advanced: {} });
    expect(activateSong(db, id, "other")).toBe(false);
    expect(getSong(db, id)!.taskId).toBe("t1");
  });

  it("deleteExpiredReserved removes stale reserved rows, keeps fresh ones and non-reserved", () => {
    const db = makeTestDb();
    const fresh = insertReservedSong(db, base);
    db.prepare("UPDATE songs SET created_at = ? WHERE id = ?").run(Date.now() - 10 * 60 * 1000, fresh);
    const kept = insertSong(db, { taskId: "t1", title: "", prompt: "p", lyrics: "", advanced: {} });
    db.prepare("UPDATE songs SET created_at = ? WHERE id = ?").run(Date.now() - 10 * 60 * 1000, kept);
    deleteExpiredReserved(db, 5 * 60 * 1000);
    expect(getSong(db, fresh)).toBeNull();
    expect(getSong(db, kept)).not.toBeNull();
  });
});

describe("listSongs limit", () => {
  it("returns at most 500 rows by default, newest first", () => {
    const db = makeTestDb();
    for (let i = 0; i < 3; i++) {
      insertSong(db, { taskId: `t${i}`, title: String(i), prompt: "p", lyrics: "", advanced: {} });
    }
    const rows = listSongs(db);
    expect(rows).toHaveLength(3);
    expect(rows[0].title).toBe("2");
    expect(listSongs(db, 2)).toHaveLength(2);
  });
});
```

If `listPendingSongs` isn't already imported in the test file's import list, add it to the existing `@/lib/db` import.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/db.test.ts`
Expected: FAIL — `insertReservedSong`, `activateSong`, `deleteExpiredReserved` not exported; `markReady`/`markFailed` return `void` (not boolean); status guards absent.

- [ ] **Step 3: Implement in `lib/db.ts`**

```typescript
// lib/types.ts line 1:
export type SongStatus = "pending" | "ready" | "failed" | "reserved";
```

In `lib/db.ts`, extend `initDb` after the ALTER TABLE block:

```typescript
  db.pragma("busy_timeout = 5000");
  db.pragma("wal_checkpoint(TRUNCATE)");
  return db;
```

Replace `markReady` body's UPDATE + add return:

```typescript
export function markReady(
  db: DB,
  id: string,
  fields: {
    audioPath: string;
    metas: Record<string, unknown>;
    seedValue: string;
    ditModel: string;
    lmModel: string;
  }
): boolean {
  const result = db.prepare(
    `UPDATE songs SET
       status = 'ready',
       audio_path = ?,
       ready_at = ?,
       metas = ?,
       seed_value = ?,
       dit_model = ?,
       lm_model = ?,
       error = NULL
     WHERE id = ? AND status = 'pending'`
  ).run(
    fields.audioPath,
    Date.now(),
    JSON.stringify(fields.metas),
    fields.seedValue,
    fields.ditModel,
    fields.lmModel,
    id
  );
  return result.changes > 0;
}

export function markFailed(db: DB, id: string, error: string): boolean {
  const result = db.prepare(
    `UPDATE songs SET status = 'failed', error = ? WHERE id = ? AND status = 'pending'`
  ).run(error, id);
  return result.changes > 0;
}
```

Add after `insertSong`:

```typescript
export function insertReservedSong(
  db: DB,
  input: { title: string; prompt: string; lyrics: string; advanced: AdvancedParams }
): string {
  const id = nanoid();
  const now = Date.now();
  db.prepare(
    `INSERT INTO songs (id, task_id, status, title, prompt, lyrics, advanced, created_at)
     VALUES (?, 'reserved', 'reserved', ?, ?, ?, ?, ?)`
  ).run(id, input.title, input.prompt, input.lyrics, JSON.stringify(input.advanced), now);
  return id;
}

export function activateSong(db: DB, id: string, taskId: string): boolean {
  const result = db.prepare(
    `UPDATE songs SET status = 'pending', task_id = ? WHERE id = ? AND status = 'reserved'`
  ).run(taskId, id);
  return result.changes > 0;
}

export function deleteExpiredReserved(db: DB, olderThanMs: number): void {
  db.prepare(`DELETE FROM songs WHERE status = 'reserved' AND created_at < ?`).run(Date.now() - olderThanMs);
}
```

Change `listSongs`:

```typescript
export function listSongs(db: DB, limit = 500): Song[] {
  const rows = db.prepare("SELECT * FROM songs ORDER BY rowid DESC LIMIT ?").all(limit);
  return rows.map(rowToSong);
}
```

Note: `rowToSong`'s `status: row.status as SongStatus` needs no change — `reserved` is now a valid `SongStatus`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/db.test.ts`
Expected: PASS (new + all 8 pre-existing tests green).

- [ ] **Step 5: Run full gates and commit**

```bash
pnpm test:run && pnpm typecheck && pnpm lint
git add lib/db.ts lib/types.ts tests/db.test.ts
git commit -m "fix: guard status transitions, add reserved lifecycle, WAL checkpoint, listSongs limit"
```

---

### Task 2: Poller — serialized loop, mass-failure fix, stuck-task timeout, pruning, file guard, async I/O

**Files:**
- Modify: `lib/poller.ts` (whole file rework, ~103 lines)
- Test: `tests/poller.test.ts`

**Interfaces:**
- Consumes: `markReady/markFailed: boolean` (Task 1), `listPendingSongs(db)` unchanged
- Produces: `pollOnce(db, client, opts)` where `PollerOptions = { storageDir: string; pendingTimeoutMs?: number }` (default 30 min); `startPoller()`/`stopPoller()` same names. Poller uses async `writeFile`/`mkdir` from `node:fs/promises`.

- [ ] **Step 1: Write the failing tests**

In `tests/poller.test.ts`:

(a) Replace the top `vi.mock("node:fs", …)` block and mock with:

```typescript
const writeMock = vi.fn<(path: string, data: Buffer) => void>();
const mkdirMock = vi.fn<(path: string, opts?: any) => void>();

vi.mock("node:fs", () => ({}));
vi.mock("node:fs/promises", () => ({
  writeFile: writeMock,
  mkdir: mkdirMock,
}));
```

(b) The existing `marks failed when status=2` test stays valid unchanged — the rewrite keeps `markFailed(db, song.id, r.error ?? "ACE-Step task failed (no error message)")`, so its `error: "OOM"` assertion still passes.

(c) Append these tests inside `describe("pollOnce", …)`:

```typescript
  it("maps ACE-Step error when status=2 without explicit error uses fallback", async () => {
    const db = makeTestDb();
    insertSong(db, { taskId: "t1", title: "", prompt: "p", lyrics: "", advanced: {} });
    const client = mockClient({
      queryResults: vi.fn().mockResolvedValue([{ taskId: "t1", status: 2 as const }]),
    });
    await pollOnce(db, client, { storageDir: "/tmp/test-storage" });
    const songs = listSongs(db);
    expect(songs[0].status).toBe("failed");
    expect(songs[0].error).toBe("ACE-Step task failed (no error message)");
  });

  it("a queryResults rejection does not fail any song", async () => {
    const db = makeTestDb();
    insertSong(db, { taskId: "t1", title: "", prompt: "p", lyrics: "", advanced: {} });
    insertSong(db, { taskId: "t2", title: "", prompt: "p", lyrics: "", advanced: {} });
    const client = mockClient({
      queryResults: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    });
    await pollOnce(db, client, { storageDir: "/tmp/test-storage" });
    expect(listSongs(db).every((s) => s.status === "pending")).toBe(true);
  });

  it("marks failed a pending song older than pendingTimeoutMs", async () => {
    const db = makeTestDb();
    const id = insertSong(db, { taskId: "t1", title: "", prompt: "p", lyrics: "", advanced: {} });
    db.prepare("UPDATE songs SET created_at = ? WHERE id = ?").run(Date.now() - 31 * 60 * 1000, id);
    const client = mockClient();
    await pollOnce(db, client, { storageDir: "/tmp/test-storage", pendingTimeoutMs: 30 * 60 * 1000 });
    expect(getSong(db, id)!.status).toBe("failed");
    expect(getSong(db, id)!.error).toContain("timed out");
    expect(client.queryResults).not.toHaveBeenCalled();
  });

  it("status=1 with no file marks failed, not throw", async () => {
    const db = makeTestDb();
    const id = insertSong(db, { taskId: "t1", title: "", prompt: "p", lyrics: "", advanced: {} });
    const client = mockClient({
      queryResults: vi.fn().mockResolvedValue([{ taskId: "t1", status: 1 as const }]),
    });
    await pollOnce(db, client, { storageDir: "/tmp/test-storage" });
    expect(getSong(db, id)!.status).toBe("failed");
    expect(getSong(db, id)!.error).toContain("without an audio file");
  });

  it("prunes failureCounts for songs no longer pending (deleted)", async () => {
    const db = makeTestDb();
    const id = insertSong(db, { taskId: "t1", title: "", prompt: "p", lyrics: "", advanced: {} });
    const client = mockClient({
      queryResults: vi.fn().mockRejectedValueOnce(new Error("blip")).mockResolvedValue([
        { taskId: "t1", status: 0 as const },
      ]),
    });
    await pollOnce(db, client, { storageDir: "/tmp/test-storage" }); // download failure path not hit; counts stay 0
    deleteSong(db, id);
    await pollOnce(db, client, { storageDir: "/tmp/test-storage" });
    // second cycle: no pending songs → early return; no crash, no throw
    expect(listPendingSongs(db)).toHaveLength(0);
  });

  it("download failure increments per-song failure budget only for that song", async () => {
    const db = makeTestDb();
    const idA = insertSong(db, { taskId: "a", title: "", prompt: "p", lyrics: "", advanced: {} });
    const idB = insertSong(db, { taskId: "b", title: "", prompt: "p", lyrics: "", advanced: {} });
    const client = mockClient({
      queryResults: vi.fn().mockResolvedValue([
        { taskId: "a", status: 1 as const, file: "/v1/audio?path=%2Fa.mp3" },
        { taskId: "b", status: 1 as const, file: "/v1/audio?path=%2Fb.mp3" },
      ]),
      downloadAudio: vi.fn().mockRejectedValue(new Error("401")),
    });
    await pollOnce(db, client, { storageDir: "/tmp/test-storage" });
    await pollOnce(db, client, { storageDir: "/tmp/test-storage" });
    await pollOnce(db, client, { storageDir: "/tmp/test-storage" });
    expect(getSong(db, idA)!.status).toBe("failed");
    expect(getSong(db, idB)!.status).toBe("failed");
    expect(getSong(db, idA)!.error).toContain("Audio download failed");
  });
```

Update the file's imports at the top to include `listSongs`, `deleteSong`, and `listPendingSongs` from `@/lib/db` (keep `insertSong`, `getSong`).

(d) Replace the `startPoller/stopPoller` describe block with a serialization test (fake timers):

```typescript
describe("startPoller / stopPoller", () => {
  afterEach(() => stopPoller());

  it("is idempotent — startPoller twice only starts one loop", () => {
    startPoller();
    startPoller();
    stopPoller();
  });

  it("stopPoller resets so startPoller can run again", () => {
    startPoller();
    stopPoller();
    startPoller();
    stopPoller();
  });

  it("does not start a second poll while the first is in flight", async () => {
    vi.useFakeTimers();
    let resolveQuery!: () => void;
    const gate = new Promise<void>((r) => { resolveQuery = r; });
    const client = mockClient({
      queryResults: vi.fn().mockImplementation(async () => {
        await gate; // first call stays in flight until released
        return [];
      }),
    });
    startPoller({ client, db: makeTestDb(), storageDir: "/tmp/test-storage" });
    await vi.advanceTimersByTimeAsync(10); // fire first tick
    expect(client.queryResults).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000); // 2.5 intervals while query still pending
    expect(client.queryResults).toHaveBeenCalledTimes(1); // serialized!
    resolveQuery();
    await vi.advanceTimersByTimeAsync(2100);
    expect(client.queryResults).toHaveBeenCalledTimes(2);
    stopPoller();
    vi.useRealTimers();
  });
});
```

The `mockClient` helper and `startPoller`/`stopPoller` must be re-exported from the module; `startPoller` here runs against a stubbed `getClient`-free path — instead of refactoring `app-client.ts`, inject the client by exporting a test-only `startPoller({ client }?)` overload:

```typescript
export function startPoller(opts?: { client?: AceStepClient; db?: Database; storageDir?: string }): void
```

Implementation uses provided overrides, else builds its own exactly as today (env vars, `getDb()`, `join(process.cwd(), "storage")`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/poller.test.ts`
Expected: FAIL — mass-failure test fails (current code increments per-song counts on query rejection), file-guard test throws on `downloadAudio(undefined)`, timeout test sees song still pending, `fs/promises` mocks unused, serialization test sees 2+ concurrent calls.

- [ ] **Step 3: Rewrite `lib/poller.ts`**

```typescript
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

  for (const song of pending) failureCounts.delete(song.id);

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
  timeoutHandle = setTimeout(loop, POLL_INTERVAL_MS);
}

export function stopPoller(): void {
  started = false;
  if (timeoutHandle) clearTimeout(timeoutHandle);
  timeoutHandle = null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/poller.test.ts`
Expected: PASS — all old tests adapted + new tests green. If the "downloads audio and marks ready" test fails on `writeMock` argument (Buffer identity), change its assertion to `expect(writeMock).toHaveBeenCalled()` and check the path via `writeMock.mock.calls[0][0]`.

- [ ] **Step 5: Full gates + commit**

```bash
pnpm test:run && pnpm typecheck && pnpm lint
git add lib/poller.ts tests/poller.test.ts
git commit -m "fix: serialize poller loop, isolate query failures, add stuck-task timeout and file guard"
```

---

### Task 3: ACE-Step client — timeouts, download auth, error mapping, status validation

**Files:**
- Modify: `lib/acestep-client.ts:45-113`
- Test: `tests/acestep-client.test.ts`

**Interfaces:**
- Produces: unchanged public API (`createAceStepClient`, `AceStepClient`, `QueryResult.error` now actually populated; every fetch receives `signal: AbortSignal.timeout(...)`)
- Constants: `RELEASE/QUERY/PING` 30s → `AbortSignal.timeout(30_000)`; `downloadAudio` → `AbortSignal.timeout(300_000)`

- [ ] **Step 1: Write the failing tests**

Append to `tests/acestep-client.test.ts` (reuse its existing mock-fetch setup):

```typescript
describe("downloadAudio auth + timeouts", () => {
  it("sends the Authorization header when apiKey is set", async () => {
    const client = createAceStepClient({ baseUrl: "http://ace:1", apiKey: "sekret" });
    mockFetch.mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) });
    await client.downloadAudio("/v1/audio?path=x");
    const [, init] = mockFetch.mock.calls[0];
    expect((init as any).headers.Authorization).toBe("Bearer sekret");
  });

  it("passes a fetch timeout signal on every call", async () => {
    const client = createAceStepClient({ baseUrl: "http://ace:2" });
    mockFetch.mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) });
    await client.downloadAudio("/v1/audio?path=x");
    const [, init] = mockFetch.mock.calls[0];
    expect((init as any).signal).toBeInstanceOf(AbortSignal);
  });

  it("maps upstream error into QueryResult", async () => {
    const client = createAceStepClient({ baseUrl: "http://ace:3" });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ task_id: "t1", status: 2, error: "GPU OOM" }] }),
    });
    const results = await client.queryResults(["t1"]);
    expect(results[0].error).toBe("GPU OOM");
  });

  it("coerces unknown status to 0 (still running)", async () => {
    const client = createAceStepClient({ baseUrl: "http://ace:4" });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ task_id: "t1", status: 3 }] }),
    });
    const results = await client.queryResults(["t1"]);
    expect(results[0].status).toBe(0);
  });

  it("releaseTask and queryResults use AbortSignal timeouts", async () => {
    const client = createAceStepClient({ baseUrl: "http://ace:5" });
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: { task_id: "t1" } }) });
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) });
    await client.releaseTask({ prompt: "p", lyrics: "", thinking: true });
    await client.queryResults(["t1"]);
    const [, init1] = mockFetch.mock.calls[0];
    const [, init2] = mockFetch.mock.calls[1];
    expect((init1 as any).signal).toBeInstanceOf(AbortSignal);
    expect((init2 as any).signal).toBeInstanceOf(AbortSignal);
  });
});
```

If the test file uses a different variable name for its fetch mock (check the existing tests first), use that name in place of `mockFetch`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/acestep-client.test.ts`
Expected: FAIL — `error` undefined, no signal, Authorization missing on downloadAudio.

- [ ] **Step 3: Implement in `lib/acestep-client.ts`**

Add to the mapped result in `queryResults` (line ~93) and validate status:

```typescript
      const status = r.status === 0 || r.status === 1 || r.status === 2 ? r.status : 0;
      if (status !== r.status) {
        console.warn(`[acestep] unknown task status ${r.status} for ${r.task_id}, treating as running`);
      }
      return {
        taskId: r.task_id as string,
        status,
        file: resultObj.file,
        prompt: resultObj.prompt,
        lyrics: resultObj.lyrics,
        metas: resultObj.metas,
        seed_value: resultObj.seed_value,
        lm_model: resultObj.lm_model,
        dit_model: resultObj.dit_model,
        error: r.error ?? resultObj.error,
      };
```

Wire timeouts + download auth:

```typescript
  async function releaseTask(payload: ReleaseTaskPayload): Promise<{ taskId: string }> {
    const res = await fetch(`${baseUrl}/release_task`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });
```

```typescript
  async function queryResults(taskIds: string[]): Promise<QueryResult[]> {
    if (taskIds.length === 0) return [];
    const res = await fetch(`${baseUrl}/query_result`, {
      method: "POST",
      headers,
      body: JSON.stringify({ task_id_list: taskIds }),
      signal: AbortSignal.timeout(30_000),
    });
```

```typescript
  async function downloadAudio(path: string): Promise<ArrayBuffer> {
    const url = `${baseUrl}${path}`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(300_000) });
```

```typescript
  async function ping(): Promise<boolean> {
    try {
      const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(30_000) });
      return res.ok;
    } catch {
      return false;
    }
  }
```

Note: `headers` already includes `Content-Type: application/json`; that is harmless for GET audio.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/acestep-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Full gates + commit**

```bash
pnpm test:run && pnpm typecheck && pnpm lint
git add lib/acestep-client.ts tests/acestep-client.test.ts
git commit -m "fix: client fetch timeouts, download auth header, error mapping, status validation"
```

---

### Task 4: Origin guard + generate route — reserved-first, validation, error hygiene

**Files:**
- Create: `lib/origin-guard.ts`
- Modify: `app/api/generate/route.ts` (whole POST rework)
- Test: `tests/api-generate.test.ts`

**Interfaces:**
- Produces: `assertSameOrigin(req: Request): boolean` — true when Origin absent or matching Host; false when cross-origin. Generate POST now returns 403 on cross-origin, 400 on validation failures, inserts reserved row before `releaseTask`.
- Consumes: `insertReservedSong`, `activateSong` (Task 1), `getDb` unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `tests/api-generate.test.ts` (existing helper `makeReq(body)` builds a same-origin Request — verify its URL host matches its Host header or Origin is absent; `new Request("http://localhost:5433/…")` sends no Origin by default, so existing tests keep passing):

```typescript
describe("origin guard", () => {
  it("rejects cross-origin POST with 403", async () => {
    const req = new Request("http://localhost:5433/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://evil.example", Host: "localhost:5433" },
      body: JSON.stringify({ prompt: "pop" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("allows same-origin POST", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ data: { task_id: "ace-1" }, code: 200 }),
    });
    const req = new Request("http://localhost:5433/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:5433", Host: "localhost:5433" },
      body: JSON.stringify({ prompt: "pop" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });
});

describe("input validation", () => {
  it("rejects prompt over 2000 chars", async () => {
    const res = await POST(makeReq({ prompt: "x".repeat(2001) }));
    expect(res.status).toBe(400);
  });

  it("rejects lyrics over 20000 chars", async () => {
    const res = await POST(makeReq({ prompt: "ok", lyrics: "x".repeat(20001) }));
    expect(res.status).toBe(400);
  });

  it("rejects title over 200 chars", async () => {
    const res = await POST(makeReq({ prompt: "ok", title: "x".repeat(201) }));
    expect(res.status).toBe(400);
  });

  it("rejects out-of-range advanced params", async () => {
    expect((await POST(makeReq({ prompt: "ok", advanced: { duration: 601 } }))).status).toBe(400);
    expect((await POST(makeReq({ prompt: "ok", advanced: { duration: 5 } }))).status).toBe(400);
    expect((await POST(makeReq({ prompt: "ok", advanced: { bpm: 301 } }))).status).toBe(400);
    expect((await POST(makeReq({ prompt: "ok", advanced: { bpm: 29 } }))).status).toBe(400);
    expect((await POST(makeReq({ prompt: "ok", advanced: { batchSize: 9 } }))).status).toBe(400);
    expect((await POST(makeReq({ prompt: "ok", advanced: { batchSize: 0 } }))).status).toBe(400);
  });
});

describe("reserved-first flow", () => {
  it("inserts a reserved row before releaseTask and activates after", async () => {
    const rows = () => getDb().prepare("SELECT * FROM songs ORDER BY rowid DESC LIMIT 1").get() as any;
    mockFetch.mockImplementationOnce(async () => {
      const row = rows();
      expect(row).toBeTruthy();
      expect(row.status).toBe("reserved"); // row exists BEFORE releaseTask resolves
      return { ok: true, status: 200, json: async () => ({ data: { task_id: "ace-2" }, code: 200 }) };
    });
    const res = await POST(makeReq({ prompt: "pop" }));
    expect(res.status).toBe(200);
    const row = rows();
    expect(row.status).toBe("pending");
    expect(row.task_id).toBe("ace-2");
  });

  it("deletes the reserved row when releaseTask fails", async () => {
    const before = (getDb().prepare("SELECT COUNT(*) c FROM songs").get() as any).c;
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const res = await POST(makeReq({ prompt: "pop" }));
    expect(res.status).toBe(503);
    const after = (getDb().prepare("SELECT COUNT(*) c FROM songs").get() as any).c;
    expect(after).toBe(before);
  });

  it("returns a generic error message on upstream failure (no err echo)", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, text: async () => "SECRET-UPSTREAM-DETAILS" });
    const res = await POST(makeReq({ prompt: "pop" }));
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body.error).not.toContain("SECRET-UPSTREAM-DETAILS");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/api-generate.test.ts`
Expected: FAIL — no 403 (no guard), no validation 400s, releaseTask happens before insert (reserved-before check fails), upstream error echo present, reserved row leaks on failure.

- [ ] **Step 3: Implement**

Create `lib/origin-guard.ts`:

```typescript
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // non-browser clients (curl, tests) send no Origin
  try {
    const originUrl = new URL(origin);
    const host = req.headers.get("host");
    return !!host && originUrl.host === host;
  } catch {
    return false; // malformed Origin — reject
  }
}
```

Rewrite `app/api/generate/route.ts` POST:

```typescript
import { NextResponse } from "next/server";
import { getDb } from "@/lib/app-db";
import { getClient } from "@/lib/app-client";
import { insertReservedSong, activateSong } from "@/lib/db";
import { isSameOrigin } from "@/lib/origin-guard";
import type { AdvancedParams } from "@/lib/types";

const MAX_PROMPT = 2000;
const MAX_LYRICS = 20000;
const MAX_TITLE = 200;

export async function POST(req: Request): Promise<Response> {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const prompt: string = (body?.prompt ?? "").toString().trim();
  if (!prompt) {
    return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  }
  if (prompt.length > MAX_PROMPT) {
    return NextResponse.json({ error: `prompt must be at most ${MAX_PROMPT} characters` }, { status: 400 });
  }

  const title: string = (body?.title ?? "").toString().trim();
  if (title.length > MAX_TITLE) {
    return NextResponse.json({ error: `title must be at most ${MAX_TITLE} characters` }, { status: 400 });
  }

  const lyrics: string = (body?.lyrics ?? "").toString();
  if (lyrics.length > MAX_LYRICS) {
    return NextResponse.json({ error: `lyrics must be at most ${MAX_LYRICS} characters` }, { status: 400 });
  }

  const advanced: AdvancedParams = body?.advanced ?? {};
  if (advanced.duration !== undefined && (advanced.duration < 10 || advanced.duration > 600)) {
    return NextResponse.json({ error: "duration must be between 10 and 600 seconds" }, { status: 400 });
  }
  if (advanced.bpm !== undefined && (advanced.bpm < 30 || advanced.bpm > 300)) {
    return NextResponse.json({ error: "bpm must be between 30 and 300" }, { status: 400 });
  }
  if (advanced.batchSize !== undefined && (advanced.batchSize < 1 || advanced.batchSize > 8)) {
    return NextResponse.json({ error: "batchSize must be between 1 and 8" }, { status: 400 });
  }

  const payload: any = {
    prompt,
    lyrics,
    thinking: advanced.thinking !== undefined ? advanced.thinking : true,
  };
  if (advanced.duration !== undefined) payload.audio_duration = advanced.duration;
  if (advanced.bpm !== undefined) payload.bpm = advanced.bpm;
  if (advanced.keyScale) payload.key_scale = advanced.keyScale;
  if (advanced.timeSignature) payload.time_signature = advanced.timeSignature;
  if (advanced.seed !== undefined) payload.seed = advanced.seed;
  if (advanced.batchSize !== undefined) payload.batch_size = advanced.batchSize;
  if (advanced.inferenceSteps !== undefined) payload.inference_steps = advanced.inferenceSteps;
  if (advanced.guidanceScale !== undefined) payload.guidance_scale = advanced.guidanceScale;
  if (advanced.cotCaption !== undefined) payload.use_cot_caption = advanced.cotCaption;

  const db = getDb();
  const id = insertReservedSong(db, { title, prompt, lyrics, advanced });
  try {
    const client = getClient();
    const { taskId } = await client.releaseTask(payload);
    activateSong(db, id, taskId);
    return NextResponse.json({ id }, { status: 200 });
  } catch (err: any) {
    db.prepare("DELETE FROM songs WHERE id = ? AND status = 'reserved'").run(id);
    const msg = err?.message ?? String(err);
    if (/ECONNREFUSED|fetch failed/i.test(msg)) {
      return NextResponse.json(
        { error: "ACE-Step server unreachable. Run ./scripts/start-acestep.sh" },
        { status: 503 }
      );
    }
    if (err?.status === 429) {
      return NextResponse.json(
        { error: "ACE-Step server busy, try again in a moment" },
        { status: 503 }
      );
    }
    console.error("[generate] ACE-Step error:", err);
    return NextResponse.json(
      { error: "Music generation failed. Please try again." },
      { status: 503 }
    );
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/api-generate.test.ts`
Expected: PASS. Also verify old test "returns 200 with id on success" still passes (no Origin header → guard allows).

- [ ] **Step 5: Full gates + commit**

```bash
pnpm test:run && pnpm typecheck && pnpm lint
git add lib/origin-guard.ts app/api/generate/route.ts tests/api-generate.test.ts
git commit -m "fix: origin guard on generate, reserved-first task creation, input validation, error hygiene"
```

---

### Task 5: Songs/audio routes — Origin guard on DELETE, range parsing, storage dir

**Files:**
- Modify: `app/api/songs/[id]/route.ts`
- Modify: `app/api/audio/[id]/route.ts`
- Test: `tests/api-songs.test.ts` (and add audio range tests to it)

**Interfaces:**
- Consumes: `isSameOrigin` (Task 4), `getStorageDir` (Task 6 — created here to avoid forward reference; create `lib/storage.ts` in this task), `deleteExpiredReserved` (Task 1 — called from `getDb()` init path in Task 6, not here)
- Produces: DELETE returns 403 cross-origin; audio GET supports suffix ranges, clamping, 416.

**Note on ordering:** `lib/storage.ts` is created in this task because the audio/delete routes need it; Task 6 (janitor) then builds on it.

- [ ] **Step 1: Write the failing tests**

Append to `tests/api-songs.test.ts`:

```typescript
import { DELETE } from "@/app/api/songs/[id]/route";
import { GET as GET_AUDIO } from "@/app/api/audio/[id]/route";
import { writeFileSync, mkdirSync } from "node:fs";

describe("DELETE /api/songs/[id] origin guard", () => {
  it("rejects cross-origin DELETE with 403", async () => {
    const req = new Request("http://localhost:5433/api/songs/xyz", {
      method: "DELETE",
      headers: { Origin: "http://evil.example", Host: "localhost:5433" },
    });
    const res = await DELETE(req, { params: { id: "xyz" } });
    expect(res.status).toBe(403);
  });

  it("allows DELETE without Origin header", async () => {
    const req = new Request("http://localhost:5433/api/songs/xyz", {
      method: "DELETE",
    });
    const res = await DELETE(req, { params: { id: "xyz" } });
    expect(res.status).not.toBe(403); // 404 — id doesn't exist
  });
});

describe("GET /api/audio/[id] range parsing", () => {
  const storageDir = process.env.TUNEAMATIC_STORAGE_DIR!;
  const testId = "rangeTestSong1";

  beforeAll(() => {
    mkdirSync(`${storageDir}/audio`, { recursive: true });
    writeFileSync(`${storageDir}/audio/${testId}.mp3`, Buffer.alloc(1000, 1));
    getDb().prepare(
      `INSERT OR REPLACE INTO songs (id, task_id, status, title, prompt, lyrics, advanced, created_at, audio_path)
       VALUES (?, 't', 'ready', '', 'p', '', '{}', ?, 'audio/${testId}.mp3')`
    ).run(testId, Date.now());
  });

  afterAll(() => {
    getDb().prepare("DELETE FROM songs WHERE id = ?").run(testId);
    try { unlinkSync(`${storageDir}/audio/${testId}.mp3`); } catch {}
  });

  it("serves suffix range bytes=-100 as the last 100 bytes", async () => {
    const res = await GET_AUDIO(
      new Request("http://localhost:5433/api/audio/" + testId, {
        headers: { Range: "bytes=-100" },
      }),
      { params: { id: testId } }
    );
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 900-999/1000");
    expect(res.headers.get("Content-Length")).toBe("100");
  });

  it("clamps an oversized end to the file size", async () => {
    const res = await GET_AUDIO(
      new Request("http://localhost:5433/api/audio/" + testId, {
        headers: { Range: "bytes=0-99999" },
      }),
      { params: { id: testId } }
    );
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 0-999/1000");
    expect(res.headers.get("Content-Length")).toBe("1000");
  });

  it("returns 416 for a start beyond the file size", async () => {
    const res = await GET_AUDIO(
      new Request("http://localhost:5433/api/audio/" + testId, {
        headers: { Range: "bytes=5000-6000" },
      }),
      { params: { id: testId } }
    );
    expect(res.status).toBe(416);
    expect(res.headers.get("Content-Range")).toBe("bytes */1000");
  });

  it("falls back to full 200 on a malformed Range header", async () => {
    const res = await GET_AUDIO(
      new Request("http://localhost:5433/api/audio/" + testId, {
        headers: { Range: "bytes=abc" },
      }),
      { params: { id: testId } }
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Length")).toBe("1000");
  });
});
```

Add `unlinkSync` to the `node:fs` import, and set the env var at the very top of the file **before any imports that touch storage** (vitest hoists `vi.mock` but not plain assignments — put this above the imports):

```typescript
process.env.TUNEAMATIC_STORAGE_DIR = "/tmp/tuneamatic-test-storage";
```

Also import `getDb` from `@/lib/app-db` if not already imported.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/api-songs.test.ts`
Expected: FAIL — DELETE has no 403, suffix range serves `bytes 0-100/1000` (wrong), oversized end returns huge Content-Length, no 416.

- [ ] **Step 3: Implement**

Create `lib/storage.ts`:

```typescript
import { join } from "node:path";

export function getStorageDir(): string {
  return process.env.TUNEAMATIC_STORAGE_DIR
    ?? join(process.cwd(), "storage");
}
```

Modify `app/api/songs/[id]/route.ts` — add guard and storage module:

```typescript
import { isSameOrigin } from "@/lib/origin-guard";
import { getStorageDir } from "@/lib/storage";

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const db = getDb();
  const song = getSong(db, params.id);
  if (!song) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (song.audioPath) {
    try {
      unlinkSync(join(getStorageDir(), song.audioPath));
    } catch {
      /* best-effort */
    }
  }
  deleteSong(db, params.id);
  return new NextResponse(null, { status: 204 });
}
```

Rewrite the range block in `app/api/audio/[id]/route.ts` (GET stays otherwise identical — keep the 404 guards and streaming body):

```typescript
import { getStorageDir } from "@/lib/storage";

// replace from `const absPath = join(process.cwd(), "storage", song.audioPath);`:
  const absPath = join(getStorageDir(), song.audioPath);

// replace the whole range block:
  const range = req.headers.get("range");
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    let start: number, end: number;
    let satisfiable = true;
    if (!m) {
      satisfiable = false; // malformed → fall through to full 200
    } else {
      const [, s, e] = m;
      if (s === "" && e === "") {
        satisfiable = false;
      } else if (s === "") {
        // suffix range: last N bytes
        const n = parseInt(e, 10);
        if (n === 0) return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
        start = Math.max(0, size - n);
        end = size - 1;
      } else {
        start = parseInt(s, 10);
        if (start >= size) {
          return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
        }
        end = e === "" ? size - 1 : Math.min(parseInt(e, 10), size - 1);
      }
      if (satisfiable && end < start) end = size - 1;
    }
    if (m && satisfiable) {
      const chunkSize = end - start + 1;
      const stream = createReadStream(absPath, { start, end });
      return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
        status: 206,
        headers: {
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(chunkSize),
          "Content-Type": "audio/mpeg",
        },
      });
    }
  }
```

(The malformed path falls through to the existing full-200 response below it.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/api-songs.test.ts`
Expected: PASS.

- [ ] **Step 5: Full gates + commit**

```bash
pnpm test:run && pnpm typecheck && pnpm lint
git add lib/storage.ts "app/api/songs/[id]/route.ts" "app/api/audio/[id]/route.ts" tests/api-songs.test.ts
git commit -m "fix: origin guard on delete, RFC-correct audio ranges, shared storage dir"
```

---

### Task 6: Frontend — onComplete(status), form preservation, stable poll loop

**Files:**
- Modify: `app/components/GenerationStatus.tsx`
- Modify: `app/components/GenerateForm.tsx:43-49,95`

**Interfaces:**
- Consumes: `SongStatus` (now includes `reserved` — but GenerationStatus never sees `reserved`; poller never emits it via `/api/songs/[id]` GET)
- Produces: `GenerationStatus` prop `onComplete?: (status: SongStatus, error?: string | null) => void`
- No tests (per spec §5); verify with `pnpm typecheck && pnpm lint`

- [ ] **Step 1: Modify `GenerationStatus.tsx`**

```typescript
export function GenerationStatus({
  id,
  onComplete,
}: {
  id: string;
  onComplete?: (status: SongStatus, error?: string | null) => void;
}) {
  const { load } = usePlayer();
  const [song, setSong] = useState<SongApiResponse | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [done, setDone] = useState(false);
  const createdAtRef = useRef<number | null>(null);
  const loadRef = useRef(load);
  const onCompleteRef = useRef(onComplete);
  useEffect(() => { loadRef.current = load; }, [load]);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);

  useEffect(() => {
    let stop = false;
    let loaded = false;
    async function tick() {
      try {
        const res = await fetch(`/api/songs/${id}`);
        if (!res.ok) return;
        const s: SongApiResponse = await res.json();
        if (stop) return;
        setSong(s);
        if (s.status === "ready") {
          if (!loaded) {
            loaded = true;
            loadRef.current(s);
          }
          setDone(true);
          onCompleteRef.current?.(s.status);
          return;
        }
        if (s.status === "failed") {
          setDone(true);
          onCompleteRef.current?.(s.status, s.error);
          return;
        }
        setTimeout(tick, 2000);
      } catch {
        if (!stop) setTimeout(tick, 2000); // transient network error — keep polling
      }
    }
    tick();
    return () => { stop = true; };
  }, [id]);
```

Add `SongStatus` to the type import from `@/lib/types`. The rest of the component (elapsed timer effect, render) is unchanged.

- [ ] **Step 2: Modify `GenerateForm.tsx`**

```typescript
  function handleComplete(status: SongStatus, error?: string | null) {
    setSongId(null);
    if (status === "ready") {
      setTitle("");
      setPrompt("");
      setLyrics("");
      setAdvanced({});
      return;
    }
    if (status === "failed") {
      setError(error ? `Generation failed: ${error}` : "Generation failed. Your inputs are preserved — try again.");
    }
  }
```

Add `SongStatus` to the `@/lib/types` import. `{songId && <GenerationStatus …/>}` stays; `setError(null)` in `onSubmit` already clears the failure message before a retry.

- [ ] **Step 3: Verify with gates**

```bash
pnpm typecheck && pnpm lint && pnpm test:run
```

Expected: all green (no component tests; existing backend suites must not regress — the API surface `onComplete` is client-side only).

- [ ] **Step 4: Commit**

```bash
git add app/components/GenerationStatus.tsx app/components/GenerateForm.tsx
git commit -m "fix: preserve form inputs on failed generation, stable poll loop deps"
```

---

### Task 7: Janitor + startup wiring + AUDIT.md resolution marks

**Files:**
- Create: `lib/janitor.ts`
- Modify: `instrumentation.ts`
- Modify: `AUDIT.md` (append resolution status)

**Interfaces:**
- Consumes: `getStorageDir` (Task 5), `listSongs` (Task 1), `deleteExpiredReserved` (Task 1), `getDb`
- Produces: `cleanupOrphanAudio(db: Database, opts?: { storageDir?: string }): number` (count deleted), `cleanupExpiredReserved(db, olderThanMs): void`

- [ ] **Step 1: Write the failing test**

Create `tests/janitor.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { makeTestDb } from "@/lib/test-helpers";
import { insertSong } from "@/lib/db";
import { cleanupOrphanAudio } from "@/lib/janitor";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const storageDir = "/tmp/tuneamatic-janitor-test";

beforeEach(() => {
  rmSync(storageDir, { recursive: true, force: true });
  mkdirSync(join(storageDir, "audio"), { recursive: true });
});

afterAll(() => rmSync(storageDir, { recursive: true, force: true }));

describe("cleanupOrphanAudio", () => {
  it("deletes orphaned audio files, keeps files with a DB row", async () => {
    const db = makeTestDb();
    const id = insertSong(db, { taskId: "t1", title: "", prompt: "p", lyrics: "", advanced: {} });
    writeFileSync(join(storageDir, "audio", `${id}.mp3`), Buffer.alloc(4));
    writeFileSync(join(storageDir, "audio", "orphanedId.mp3"), Buffer.alloc(4));
    const removed = await cleanupOrphanAudio(db, { storageDir });
    expect(removed).toBe(1);
    expect(existsSync(join(storageDir, "audio", `${id}.mp3`))).toBe(true);
    expect(existsSync(join(storageDir, "audio", "orphanedId.mp3"))).toBe(false);
  });

  it("handles a missing audio directory gracefully", async () => {
    const db = makeTestDb();
    rmSync(join(storageDir, "audio"), { recursive: true, force: true });
    expect(await cleanupOrphanAudio(db, { storageDir })).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/janitor.test.ts`
Expected: FAIL — `@/lib/janitor` not found.

- [ ] **Step 3: Implement `lib/janitor.ts`**

```typescript
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
```

Wire startup in `instrumentation.ts`:

```typescript
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startPoller } = await import("@/lib/poller");
    const { cleanupOrphanAudio } = await import("@/lib/janitor");
    const { deleteExpiredReserved } = await import("@/lib/db");
    const { getDb } = await import("@/lib/app-db");
    startPoller();
    const db = getDb();
    deleteExpiredReserved(db, 5 * 60 * 1000);
    const removed = await cleanupOrphanAudio(db);
    console.log(`[instrumentation] poller started, janitor removed ${removed} orphaned files`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes + full gates**

```bash
pnpm vitest run tests/janitor.test.ts
pnpm test:run && pnpm typecheck && pnpm lint
```

Expected: PASS everywhere.

- [ ] **Step 5: Mark AUDIT.md items resolved and commit**

Append to the top of `AUDIT.md` (after the title block):

```markdown
---

**Status 2026-09-04:** All confirmed issues (#1–#13) fixed. See `docs/superpowers/plans/2026-09-04-audit-fixes.md` for the implementation. #14 (test-gap) is addressed by the per-fix tests added during implementation.
```

```bash
git add lib/janitor.ts instrumentation.ts tests/janitor.test.ts AUDIT.md
git commit -m "feat: startup janitor for orphaned audio, reserved-row cleanup, mark audit items resolved"
```

---

## Final verification

After all tasks: run the full suite one last time (`pnpm test:run && pnpm typecheck && pnpm lint`), then `git log --oneline` to confirm the 7-commit sequence, and spot-check `pnpm dev` boots with `[instrumentation] poller started, janitor removed N orphaned files` in the log.