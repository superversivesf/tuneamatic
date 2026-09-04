# Tuneamatic Audit Fixes — Design Spec

**Date:** 2026-09-04
**Status:** Approved
**Project:** Tuneamatic — remediation of findings in `AUDIT.md` (2026-09-04 multi-agent audit)
**Prior spec:** `docs/superpowers/specs/2026-07-26-tuneamatic-design.md` (original app design; still authoritative for everything not modified here)

## Goal

Fix all confirmed issues from the 2026-09-04 audit (`AUDIT.md` #1–#13) with test-driven development, without breaking the existing app contract. The one intentionally-deferred finding is #14 (test-gap note) which is subsumed by this spec's TDD approach. Refuted findings are not addressed.

## Scope decisions (approved by user)

- **All confirmed issues #1–#13** are in scope.
- **LAN binding stays** (deliberate per commit f670996). Mutating routes get an Origin guard instead.
- **Tests-first** for every backend fix. Frontend fixes are verified by typecheck + lint only (consistent with the v1 spec's "No frontend tests for v1" decision; adding a component test harness for two components is not proportionate).

## Approach

Layered TDD on a single branch, 7 commits grouped by architectural layer (db → poller → client → API routes → frontend → storage → janitor). Each layer's tests are written before its implementation; each commit passes `pnpm test:run` + `pnpm typecheck` + `pnpm lint`.

---

## 1. DB layer — status machine hardening

**Files:** `lib/db.ts`, `lib/types.ts`

- `markReady` and `markFailed` gain `AND status = 'pending'` on their UPDATEs and return `boolean` (`result.changes > 0`). A lagging poller can no longer transition a terminal song (`ready` → `failed` clobber from AUDIT.md #1, second half).
- New song status `'reserved'` (extends `SongStatus`):
  - `insertSong` takes a new optional variant that inserts with `status = 'reserved'` and a placeholder `taskId` (e.g. `"reserved"`), returning the id.
  - `activateSong(db, id, taskId)` flips `reserved` → `pending` and stores the real taskId (guarded: only when `status = 'reserved'`).
  - `listPendingSongs` continues to select only `status = 'pending'` — reserved rows are invisible to the poller.
  - `deleteExpiredReserved(db, olderThanMs)` removes crash-leftover reserved rows (default max age 5 minutes) at startup.
- WAL management: `initDb` runs `wal_checkpoint(TRUNCATE)` after schema setup and sets `busy_timeout = 5000`. The poller triggers a checkpoint after each batch in which it marked at least one song ready (fixes unbounded WAL growth — AUDIT.md #8; 3.7 MB `-wal` observed vs 4 KB db).
- `markReady` sets `error = NULL` (clears any stale error text on the guarded transition; unreachable in practice once guarded, but correct).

## 2. Poller — races, mass-failures, stuck tasks

**File:** `lib/poller.ts`

- **Serialized loop:** replace `setInterval(pollOnce, 2000)` with a chained `setTimeout` loop — `await pollOnce().catch(log)` then schedule the next tick. Overlapping executions become impossible (AUDIT.md #1, first half).
- **No more mass-failure:** when `client.queryResults` throws, log and return — do **not** increment per-song `failureCounts` for every pending song (AUDIT.md #2). Per-song counts apply only to that song's own download failures. "ACE-Step down forever" is handled by the stuck-task timeout, not by failing songs.
- **Stuck-task timeout:** in each `pollOnce`, pending songs whose `createdAt` is older than `PENDING_TIMEOUT_MS` (default 30 min, injectable via `PollerOptions`) are `markFailed("Generation timed out")` before querying (AUDIT.md #9, first half).
- **failureCounts pruning:** at the top of each cycle, drop Map entries whose song id is not in the current pending set (AUDIT.md #9, second half — leak on deleted songs).
- **`r.file` guard:** a `status === 1` result without `file` → `markFailed("ACE-Step returned success without an audio file")` instead of `downloadAudio(undefined)` (AUDIT.md #13, "`r.file!` non-null assertion" bullet).
- **Async I/O:** `writeFileSync`/`mkdirSync` → `fs/promises` `writeFile`/`mkdir` (AUDIT.md #13, "sync file I/O" bullet).
- After a batch with ≥1 `markReady` success: `db.pragma("wal_checkpoint(TRUNCATE)")`.

## 3. ACE-Step client — timeouts, auth, error surfacing

**File:** `lib/acestep-client.ts`

- Timeouts via `AbortSignal`: 30 s for `releaseTask`, `queryResults`, `ping`; 5 min for `downloadAudio` (AUDIT.md #3).
- `downloadAudio` sends the `Authorization` header like every other call (AUDIT.md #4).
- `error: r.error ?? resultObj.error` mapped into `QueryResult` (AUDIT.md #6).
- Status validation: `r.status` outside `{0,1,2}` → `console.warn` and treat as still-running (0) rather than blindly casting (AUDIT.md #13, "status cast" bullet).

## 4. API routes — origin guard, validation, ranges

**Files:** `lib/origin-guard.ts` (new), `app/api/generate/route.ts`, `app/api/audio/[id]/route.ts`, `app/api/songs/[id]/route.ts`

- **Origin guard** (AUDIT.md #12): helper `assertSameOrigin(req)` returns 403 only when an `Origin` header is present **and** its host:port does not match the request's `Host` header. Same-origin browsers pass; curl/no-Origin clients pass; cross-site browser requests (LAN CSRF) are rejected. Applied to `POST /api/generate` and `DELETE /api/songs/[id]`.
- **Generate route ordering** (AUDIT.md #5): insert reserved row first → `releaseTask` → `activateSong(id, taskId)` → 200 `{id}`. On `releaseTask` failure the reserved row is deleted and the error propagates as today (no orphaned GPU task, no orphaned DB row).
- **Input validation** (AUDIT.md #12): prompt 1–2000 chars, lyrics ≤ 20000, title ≤ 200 (trim + 400 with a specific message when over). Numeric advanced params range-checked against ACE-Step limits: duration 10–600, bpm 30–300, batch 1–8; out-of-range → 400.
- **Error hygiene** (AUDIT.md #12): non-ECONNREFUSED/429 failures — log the full upstream error server-side, return a generic `"Music generation failed. Please try again."` message. No upstream `err.message` echo to the client.
- **Range requests** (AUDIT.md #10): RFC 7233-correct parsing — suffix ranges (`bytes=-N` → last N bytes), `start`/`end` clamped to `[0, size-1]`, unsatisfiable (`start >= size`) → 416 with `Content-Range: bytes */size`, malformed header → full 200 response.
- **Delete route:** use `getStorageDir()` from the new storage module (see §6) for the `unlinkSync` path.
- **Deliberately dropped:** Content-Disposition filename hardening — the existing `[^a-zA-Z0-9_-]→_` regex already neutralizes CRLF and quote characters; no change.

## 5. Frontend — preserve input on failure, stable poll loop

**Files:** `app/components/GenerationStatus.tsx`, `app/components/GenerateForm.tsx`

- `GenerationStatus`'s `onComplete` becomes `onComplete(status: SongStatus, error?: string | null)`.
  - `ready`: `GenerateForm.handleComplete` clears the form (existing behavior).
  - `failed`: **prompt, lyrics, title, advanced are preserved**; only `songId` is cleared (re-enables the Generate button). The failure reason is surfaced through the form's existing error area so the user can retry immediately (AUDIT.md #7).
- Poll-loop effect deps become `[id]` only; `load` and `onComplete` are read through refs inside the loop so the loop is no longer torn down and recreated on every parent render (AUDIT.md #11). `tick()` is wrapped in try/catch — no unhandled promise rejections.
- No component tests (per scope decision); verified via `pnpm typecheck` + `pnpm lint`.

## 6. Storage consolidation + janitor

**Files:** `lib/storage.ts` (new), `lib/poller.ts`, `app/api/audio/[id]/route.ts`, `app/api/songs/[id]/route.ts`

- `lib/storage.ts` exports `getStorageDir()`: `process.env.TUNEAMATIC_STORAGE_DIR` if set, else `join(process.cwd(), "storage")`. Replaces all three hardcoded `join(process.cwd(), "storage", …)` sites (AUDIT.md #13, "storage dir hardcoded" bullet).
- **Startup janitor** (AUDIT.md #13, "orphan janitor" bullet): in `instrumentation.ts` registration (after `startPoller()`), scan `storage/audio/` and delete files whose `basename-without-extension` doesn't match any `songs.id`. Handles orphans from deleted-mid-download songs and any leftover files from failed generations. Best-effort: per-file errors are logged and skipped.
- `listSongs(db, limit = 500)` — bounded query (AUDIT.md #13, "no pagination on listSongs" bullet). `ORDER BY rowid DESC` retained. A personal library larger than 500 exceeds the page's usefulness; raise via future pagination if ever needed.

## 7. Testing strategy

Tests-first for each backend layer, in `tests/` alongside the existing suite (vitest):

- `db.test.ts` additions: status-guard invariants (`markFailed` after `markReady` is a no-op and vice versa; both return booleans), `reserved` lifecycle (insert → activate → pending; poller invisibility via `listPendingSongs`), `deleteExpiredReserved`, WAL checkpoint on init (pragma observable), `listSongs` limit.
- `poller.test.ts` additions: serialized loop (fake timers — second tick cannot start while first is in flight), global query failure does not fail any song, stuck-task timeout marks stale pending failed, `failureCounts` pruned for deleted songs, missing `file` → failed, async write path used.
- `acestep-client.test.ts` additions: `downloadAudio` sends Authorization, timeouts wired (fetch receives a signal), error field mapped, invalid status coerced to 0 with no throw.
- `api-generate.test.ts` additions: reserved-first flow (row exists before releaseTask), orphan cleanup on releaseTask failure, input length/range 400s, generic error message on upstream error (no message echo), Origin guard 403 on cross-origin POST.
- `api-songs.test.ts` / audio route tests: Origin guard on DELETE, range parsing (suffix ranges, clamping, 416), 404 unchanged.
- Janitor test: orphaned file removed, matching file kept.

**Verification gates per commit:** `pnpm test:run && pnpm typecheck && pnpm lint` — all green before the next layer starts.

## Out of scope

- Auth, rate limiting, HTTP method restrictions (refuted/YAGNI for a local tool — per audit round 2 consensus).
- Pagination UI, retention policy UI (a `LIMIT` is applied; full pagination deferred).
- Refuted findings (path traversal, range NaN, missing tests dir, player restart-at-0) — no code changes.
- Next 15 migration / dependency upgrades.

## Commit sequence (single branch)

1. `db`: status guards + reserved lifecycle + WAL/busy_timeout + listSongs limit
2. `poller`: serialized loop + mass-failure fix + stuck-task timeout + pruning + file guard + async I/O
3. `client`: timeouts + download auth + error mapping + status validation
4. `api routes`: origin guard + reserved-first generate + validation + error hygiene + range parsing
5. `frontend`: onComplete(status) + form preservation + stable effect deps
6. `storage`: getStorageDir + 3 call-site migrations + janitor
7. `docs`: mark AUDIT.md items resolved

**Reference:** full findings and evidence in `AUDIT.md` at the repo root.