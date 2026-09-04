# Tuneamatic Audit Report

**Date:** 2026-09-04
**Method:** 3 independent agents (pi/kimi-k2.6, codex/qwen3.5:397b, claude/minimax-m3) each audited with a unique focus (async/state, API/validation, frontend/persistence), followed by a cross-critique round. All findings below were verified against the actual code; refuted claims are listed at the end with evidence.

**Context:** local single-user app (Next.js frontend → ACE-Step API, SQLite storage, file-based audio). Priorities reflect that threat model.

---

## Confirmed issues (fix these)

### 1. CRITICAL — Poller race can clobber successful songs (`ready` → `failed`)
**Files:** `lib/poller.ts:92`, `lib/db.ts:90-114`

`startPoller` uses `setInterval(pollOnce, 2000)` which fires regardless of whether the previous `pollOnce` (network I/O + `writeFileSync` of an ~3 MB MP3) finished. Concurrent polls over the same pending set can race: Poll A downloads and calls `markReady`; Poll B's `downloadAudio` fails and calls `markFailed` — and since neither UPDATE has `AND status = 'pending'`, the finished song is overwritten to `failed`. Also risks double `writeFileSync` to the same path.

**Fix (two lines of substance):**
- `lib/db.ts`: add `AND status = 'pending'` to both UPDATEs in `markReady`/`markFailed`; check `result.changes` before proceeding.
- `lib/poller.ts`: replace `setInterval` with a chained `setTimeout` loop (or an `isPolling` guard).

All three agents confirmed this; it's the highest-impact bug in the app.

### 2. HIGH — One transient `queryResults` failure mass-fails every pending song
**File:** `lib/poller.ts:30-39`

If `queryResults` throws once (network blip, ACE restart), the catch block increments `failureCounts` for **every** pending song. Three blips over a few seconds → all in-flight generations flip to `failed` even though their tasks are healthy.

**Fix:** retry the `queryResults` call itself (with backoff) before penalizing songs; or use a global counter separate from per-song counts.

### 3. HIGH — No fetch timeouts anywhere
**File:** `lib/acestep-client.ts:48-113`

No `AbortSignal` on any `fetch` (releaseTask, queryResults, downloadAudio, ping). A hung upstream stalls `/api/generate` forever and compounds the poller overlap (issue 1), since each hung poll spawns another overlapping interval.

**Fix:** `signal: AbortSignal.timeout(30000)` on every call.

### 4. HIGH — `downloadAudio` omits the Authorization header
**File:** `lib/acestep-client.ts:97-99`

`releaseTask` and `queryResults` send `Authorization: Bearer …`, but `downloadAudio` does a bare `fetch(url)`. If ACE-Step requires auth for audio, every download 401s and songs eventually mark failed. (Found by pi in round 2; missed in round 1 by all.)

**Fix:** pass `headers` in the `downloadAudio` fetch.

### 5. HIGH — `releaseTask` before DB insert orphans ACE-Step tasks
**File:** `app/api/generate/route.ts:41-43`

The task is released to ACE-Step before `insertSong` runs. If the insert throws (disk full, schema drift), the taskId is lost; the poller never learns of it. Wasted GPU cycles on the inference server.

**Fix:** insert a placeholder row first (`status = 'reserved'`), then `releaseTask`, then update to `pending` with the taskId; on failure mark the placeholder failed (and ideally cancel the task).

### 6. HIGH — ACE-Step error messages are dropped
**File:** `lib/acestep-client.ts:83-93`

`QueryResult.error` is declared (line 23) but never mapped from the upstream response, so `lib/poller.ts:79` always falls back to "ACE-Step task failed (no error message)". Users can't see why a generation failed.

**Fix:** add `error: resultObj.error ?? r.error` to the mapped result.

### 7. HIGH (UX) — Failed generation wipes the user's prompt and lyrics
**Files:** `app/components/GenerationStatus.tsx:39-42`, `app/components/GenerateForm.tsx:43-49`

`onComplete` fires for both `ready` and `failed`, and `handleComplete` clears all form fields. On failure the user loses the exact input they'd want to retry.

**Fix:** pass status to `onComplete` (or split `onReady`/`onFailed`) and only clear on success.

### 8. MEDIUM — WAL never checkpointed; unbounded growth
**File:** `lib/db.ts:31`

WAL mode is enabled with no checkpoint anywhere. Evidence: `data/tuneamatic.db-wal` is already 3.7 MB vs a 4 KB main DB. Grows for the life of the process.

**Fix:** `db.pragma("wal_checkpoint(TRUNCATE)")` on startup and/or periodically.

### 9. MEDIUM — Pending songs live forever; `failureCounts` leaks on delete
**Files:** `lib/poller.ts:12`, `lib/poller.ts:20`

If ACE-Step drops a task, the row stays `pending` and is polled forever (no max-age check). Separately, deleting a pending song leaves its entry in the module-level `failureCounts` Map forever.

**Fix:** auto-fail pending songs older than N minutes; prune Map entries not in the pending set each cycle.

### 10. MEDIUM — Range requests: suffix ranges mis-parsed, no clamping
**File:** `app/api/audio/[id]/route.ts:31-36`

`bytes=-100` is treated as `start=0,end=100` (returns the *first* 100 bytes, violating RFC 7233), and `start`/`end` are not clamped to file size (an out-of-bounds range returns an empty 206 instead of 416). No NaN/500 bug though (see refuted list).

**Fix:** handle suffix ranges explicitly; clamp to `[0, size-1]`; return 416 for unsatisfiable ranges.

### 11. MEDIUM — GenerationStatus poll loop rebuilt on every parent render
**File:** `app/components/GenerationStatus.tsx:48`

The effect deps are `[id, load, onComplete]`, but `load` and `onComplete` are unmemoized (new identity every render: `PlayerProvider.tsx:18`, `GenerateForm.tsx:43`). Every keystroke or state update while a song generates tears down and recreates the poll loop — redundant fetches, reset `loaded` flag, and a narrow window where `onComplete` can fire twice. (Substance of Claude's H1 confirmed; its stronger "playback restarts at 0" claim was refuted by the other two and by code reading.)

**Fix:** depend only on `id`; keep `load`/`onComplete` in refs (or `useCallback` them).

### 12. LOW / hardening — LAN exposure of the dev server
**Files:** `package.json:6`, `app/api/generate/route.ts:60`, `app/api/songs/[id]/route.ts`

`next dev --hostname 0.0.0.0` binds to all interfaces while no route has auth, an Origin/CSRF check, or length limits on `prompt`/`lyrics`/`title`, and the non-ECONNREFUSED error branch echoes upstream `err.message` (which embeds upstream response bodies) to the client. Anyone on the same Wi-Fi can trigger GPU generations, delete songs (and their files), and read upstream error details. Fine solo on a home LAN; fix before ever running on shared/untrusted networks.

**Fix:** drop `--hostname 0.0.0.0` (or add an Origin check on POST/DELETE + generic error messages + input length caps).

### 13. LOW — Assorted small items
- `r.file!` non-null assertion (`lib/poller.ts:57`): a ready result with no `file` produces an opaque fetch failure and burns retry budget. Guard it.
- `storage` dir hardcoded as `join(process.cwd(), "storage")` in 3 places (`lib/poller.ts:89`, `app/api/audio/[id]/route.ts:17`, `app/api/songs/[id]/route.ts`) — breaks if started from another cwd; add a `STORAGE_DIR` env override in one shared module.
- No pagination on `listSongs` (`lib/db.ts:117-120`) — unbounded page size as the library grows.
- No orphan janitor: a file written after its row was deleted mid-download is never cleaned up.
- No `busy_timeout` pragma for multi-worker scenarios (`lib/app-db.ts`).
- `Content-Disposition` filename survives CRLF-neutralization only by accident of the regex; add explicit `[\r\n]` stripping for hygiene (`app/api/audio/[id]/route.ts:25-27`).
- Sync file I/O (`writeFileSync`/`mkdirSync`/`statSync`/`unlinkSync`) blocks the event loop; switch to `node:fs/promises` where convenient.
- `generation` status is cast blindly (`r.status as 0|1|2`, `lib/acestep-client.ts:85`): unknown statuses are silently skipped by the poller.

### 14. Test gap
`tests/` exist and are decent (42 tests across db/poller/api/client), but nothing asserts the pending-status transition invariant from issue 1 — exactly the kind of 5-line test (`markFailed` after `markReady` should be a no-op) that would have caught the top bug.

---

## Refuted claims (verified false)

| Claim | Verdict | Evidence |
|---|---|---|
| CRITICAL path traversal in `/api/audio/[id]` (Codex) | **Refuted** | `audioPath` is always `audio/${song.id}.mp3` with an internally-generated nanoid (`lib/poller.ts:54`, `lib/db.ts:45`). The upstream `r.file` value is only ever a download URL, never stored. Defense-in-depth normalization is optional, not a vulnerability. |
| Range header `NaN` → 500 (Claude M5) | **Refuted** | `m[2] ? parseInt(m[2], 10) : size - 1` (`app/api/audio/[id]/route.ts:34`) — empty end falls back to `size-1`. Real issues are the suffix-range/clamping ones in #10. |
| "No tests directory" (Codex round 2) | **Refuted** | `tests/` contains 5 files / 42 tests incl. poller, db, API routes. The gap is coverage of the status invariant, not absence of tests. |
| Player restarts playback at 0 on re-poll (Claude H3) | **Refuted** | `PlayerProvider.tsx:19` dedup guard (`song?.id === s.id && s.audioUrl`) holds in practice; the substantive issue is the effect churn in #11. |
| SQL injection via `metas` JSON (Codex) | **Refuted as SQLi** | All queries are parameterized (`?` placeholders, `lib/db.ts`). Storing unvalidated upstream JSON is a hygiene concern at most for a local app. |

---

## Disagreements & notes

- Pi and Claude both flagged sync-vs-async I/O and stuck-task timeouts; codex considered only API-layer issues (its scope). No agent contradicted another on verified facts after round 2.
- Auth/rate-limiting/method-restrictions (Codex LOWs) are deliberately **not** in the fix list: this is a personal local tool; adding auth is YAGNI unless the LAN binding is kept.

## Suggested fix order

1. Poller status guard + chained timeout (#1) — small, highest impact
2. `downloadAudio` auth header (#4) — one line
3. Map upstream error (#6) — one line
4. Global query-failure handling (#2) + fetch timeouts (#3)
5. Preserve form on failure (#7)
6. `releaseTask` ordering (#5)
7. WAL checkpoint (#8), stuck-task timeout + Map pruning (#9)
8. Range handling (#10), effect deps (#11)
9. LAN hardening (#12) if you ever run on untrusted networks
10. Assorted (#13), plus the 5-line regression test (#14)