# Tuneamatic Design Spec

**Date:** 2026-07-26
**Status:** Approved (pending user spec review)
**Project:** Tuneamatic — a web frontend for the ACE-Step 1.5 music generation model.

## Goal

A local single-user web app to generate songs from a text description and lyrics, using ACE-Step 1.5 as the generation backend. Persist generated songs in a library that survives restarts, with a sticky bottom audio player.

## Constraints & Context

- **GPU:** 12GB VRAM (not top-tier). ACE-Step must run with CPU offloading.
- **Model tier (12GB):** `acestep-v15-sft` DiT + `acestep-5Hz-lm-1.7B` LM, vLLM backend, `ACESTEP_OFFLOAD_TO_CPU=true`. Per ACE-Step's GPU compatibility table.
- **Stack:** Next.js (App Router) full-stack, single machine, ACE-Step API runs as a sibling process.
- **Persistence:** Backend-persisted library (SQLite + audio files on disk) — survives ACE-Step server restarts.
- **Audio UX:** Sticky bottom player bar (like Spotify) that persists while browsing history.
- **Generation UX:** Minimal controls (description + lyrics) plus an advanced drawer. Spinner + elapsed timer while generating.
- **No frontend tests for v1.** Pragmatic backend tests only.

## ACE-Step API Reference

ACE-Step exposes a FastAPI server on `http://localhost:8001`. Asynchronous workflow:

1. `POST /release_task` → returns `{ task_id }`
2. `POST /query_result` with `{ task_id_list: [...] }` → returns status per task (`0`=running, `1`=succeeded, `2`=failed)
3. On success, result contains `file` field = `/v1/audio?path=...` URL
4. `GET /v1/audio?path=...` → streams the generated audio file

Key parameters used by Tuneamatic:
- `prompt` (string) — music description (alias: `caption`)
- `lyrics` (string) — lyrics content
- `thinking` (bool, always `true` for us) — enables LM planning for best quality
- `audio_duration` (10–600s, alias: `duration`)
- `bpm` (30–300)
- `key_scale` (e.g. "C Major")
- `time_signature` ("2", "3", "4", "6")
- `seed` (int, `-1` = random)
- `batch_size` (1–8, we default to 1)

ACE-Step has no CORS headers → browser cannot call it directly. All ACE-Step calls go through Next.js API routes (the proxy).

## Architecture

### Runtime topology

- `scripts/start-acestep.sh` launches ACE-Step API on `:8001` (long-lived, independent process)
- `pnpm dev` (or `pnpm start`) launches Next.js on `:3000`
- Next.js owns SQLite (`data/tuneamatic.db`) and audio files (`storage/audio/`)
- Next.js connects to ACE-Step over localhost

### Data flow for one song

1. Browser `POST /api/generate` → Next.js forwards to ACE-Step `/release_task` → gets `task_id` → inserts SQLite row (`status='pending'`) → returns `{ id }`
2. Background poller (Node `setInterval`, 2s) finds `pending` rows → batch-queries ACE-Step `/query_result` → on `status=1` downloads audio to `storage/audio/[id].mp3`, updates row (`status='ready'`, metas, seed, models)
3. Browser polls `GET /api/songs/[id]` every 2s while `pending` → on `ready` hands audio URL to sticky player

### Why backend-driven polling

- **Tab-close-safe:** backend finishes the job regardless of browser state
- **Survives refresh:** frontend is a dumb read loop over DB state
- **Single-flight:** one batch `/query_result` call per poll cycle, regardless of pending count
- **No SSE complexity:** overkill for a single-user local tool

### Repo layout

```
tuneamatic/
├── app/
│   ├── api/                  # route handlers
│   ├── components/           # React components
│   ├── history/page.tsx      # Library screen
│   ├── layout.tsx            # shell + PlayerProvider
│   └── page.tsx              # Generate screen
├── lib/
│   ├── db.ts                 # better-sqlite3 connection + schema
│   ├── acestep-client.ts     # HTTP client wrapping ACE-Step API
│   └── poller.ts             # background poller singleton
├── storage/
│   └── audio/                # generated .mp3 files (gitignored)
├── data/
│   └── tuneamatic.db         # SQLite (gitignored)
├── scripts/
│   └── start-acestep.sh      # launches ACE-Step API with 12GB-tier env
├── instrumentation.ts        # Next.js hook → starts poller on boot
├── .env.local                # ACESTEP_API_URL, optional ACESTEP_API_KEY
└── package.json
```

## Data Model

Single `songs` table in SQLite (via `better-sqlite3`):

```sql
CREATE TABLE songs (
  id              TEXT PRIMARY KEY,          -- nanoid (our id, not ACE-Step's)
  task_id         TEXT NOT NULL,             -- ACE-Step task_id
  status          TEXT NOT NULL,            -- 'pending' | 'ready' | 'failed'
  prompt          TEXT NOT NULL,            -- description
  lyrics          TEXT NOT NULL DEFAULT '',
  advanced        TEXT NOT NULL DEFAULT '{}', -- JSON: duration/bpm/key/seed/batch
  audio_path      TEXT,                     -- relative: audio/[id].mp3
  error           TEXT,
  created_at      INTEGER NOT NULL,         -- ms epoch
  ready_at        INTEGER,                  -- ms epoch, null until ready
  metas           TEXT,                     -- JSON: bpm/key/duration/etc from result
  seed_value      TEXT,                     -- from result
  dit_model       TEXT,                     -- from result
  lm_model        TEXT                      -- from result
);
CREATE INDEX idx_status ON songs(status);
CREATE INDEX idx_created ON songs(created_at DESC);
```

- One song = one task. No users, playlists, or comments.
- `idx_status` serves the poller's `WHERE status='pending'` query.
- `idx_created` serves the history page's newest-first sort.
- `advanced` stores the user's advanced-drawer values as JSON for reproducibility, shown in song detail.

## API Routes

All under `app/api/`:

| Route | Method | Purpose |
|---|---|---|
| `/api/generate` | POST | Submit to ACE-Step, create song row |
| `/api/songs` | GET | List all songs (history page) |
| `/api/songs/[id]` | GET | Single song status (frontend poll target) |
| `/api/audio/[id]` | GET | Stream audio file (with `Range` support for seek) |
| `/api/songs/[id]` | DELETE | Delete song row + audio file |
| `/api/health` | GET | Liveness + ACE-Step reachability check |

### `POST /api/generate`

**Request:** `{ prompt: string, lyrics?: string, advanced?: {...} }`

**Logic:**
1. Validate `prompt` non-empty (lyrics optional — instrumental tracks exist)
2. Build ACE-Step payload: `prompt`, `lyrics`, `thinking: true` (always on for quality), spread advanced params if present (`audio_duration`, `bpm`, `key_scale`, `time_signature`, `seed`, `batch_size`)
3. `POST {ACESTEP_API_URL}/release_task` with payload
4. If ACE-Step returns non-200 or queue full (429) → return error to client, **do not** insert row
5. On success: generate nanoid `id`, insert row (`status='pending'`), return `{ id }`
6. Poller picks it up from there

**Errors:**
- ECONNREFUSED / unreachable → 503 with hint "Is the ACE-Step server running? Run `./scripts/start-acestep.sh`"
- 429 from ACE-Step → 503 "Server busy, try again in a moment", no DB row

### `GET /api/songs/[id]`

Returns `{ id, status, prompt, lyrics, advanced, createdAt, readyAt?, error?, audioUrl?, metas?, seedValue? }`
- `audioUrl` only populated when `status='ready'` → `/api/audio/[id]`
- Frontend polls this every 2s while `status='pending'`

### `GET /api/audio/[id]`

- Looks up song, verifies `status='ready'`, streams file from `storage/audio/[id].mp3`
- Passes through `Range` header for seek support
- `Content-Type: audio/mpeg`, `Accept-Ranges: bytes`
- 404 if not ready / file missing

### `DELETE /api/songs/[id]`

- Deletes DB row + removes audio file from disk (best-effort)
- If the deleted song is currently loaded in the player, frontend clears the bar

### `GET /api/health`

- Returns `{ ok: true, acestepReachable: boolean }`
- Used by frontend to show a "server status" indicator if desired

## Background Poller

Started once via `instrumentation.ts` (Next.js runs this on server boot, not per-request).

```ts
async function pollOnce() {
  const pending = db.prepare('SELECT * FROM songs WHERE status = ?').all('pending');
  if (!pending.length) return;
  const taskIds = pending.map(s => s.task_id);
  const results = await acestep.queryResult(taskIds);  // one batch call
  for (const r of results) {
    if (r.status === 1) {
      await downloadAudio(r);   // GET /v1/audio?path=... → storage/audio/[id].mp3
      db.markReady(r);          // update status, metas, seed_value, models
    } else if (r.status === 2) {
      db.markFailed(r);
    }
  }
}
setInterval(pollOnce, 2000);
```

- **Dev-safety:** Module-level `started` flag so React strict mode / HMR doesn't start two pollers.
- **Batch call:** ACE-Step accepts `task_id_list` as array → one HTTP call per poll cycle regardless of pending count.
- **Failure-retry:** Track `poll_failures` count in-memory (not DB). Reset to 0 on any successful query. On 3 consecutive query failures for a single song, mark `failed` with "ACE-Step query failed repeatedly".

## Frontend

### Components

```
app/
├── layout.tsx              # shell: routes + PlayerBar mount
├── page.tsx                # Generate screen
├── history/page.tsx        # Library screen
└── components/
    ├── GenerateForm.tsx    # prompt + lyrics + advanced drawer
    ├── AdvancedDrawer.tsx  # collapsible advanced controls
    ├── GenerationStatus.tsx # spinner + elapsed timer (polls /api/songs/[id])
    ├── SongList.tsx        # history grid (server component)
    ├── SongCard.tsx        # card with prompt/lyrics/status, click → load in player
    ├── PlayerBar.tsx       # sticky bottom <audio> + controls
    └── PlayerProvider.tsx  # React context for "currently loaded song"
```

### Player context (the spine)

```ts
type PlayerState = { song: Song | null, isPlaying: boolean };
```

`PlayerProvider` wraps the app in `layout.tsx`. Any component calls `usePlayer().load(song)` → PlayerBar swaps its `<audio src>`. When `GenerationStatus` sees `status='ready'`, it auto-loads the new song.

### Generate screen (`/`)

Layout:
```
┌─────────────────────────────────────────┐
│  Tuneamatic            [Generate] [Library]│
├─────────────────────────────────────────┤
│  Description                             │
│  ┌─────────────────────────────────────┐ │
│  │ upbeat pop song with guitar...      │ │
│  └─────────────────────────────────────┘ │
│  Lyrics                                   │
│  ┌─────────────────────────────────────┐ │
│  │ [Verse 1]                            │ │
│  │ Walking down the street...           │ │
│  └─────────────────────────────────────┘ │
│  ▾ Advanced                               │
│  [Generate song]                          │
│                                           │
│  ┌─ GenerationStatus (only while pending)─┐
│  │ ⊙ Generating…  0:42                     │
│  └─────────────────────────────────────────┘
└─────────────────────────────────────────┘
```

- "Advanced" is a collapsible drawer — expanded reveals duration (10–600 slider), BPM (30–300), key/scale (text), time signature (select 2/3/4/6), seed (int, blank=random), batch size (1–8, default 1)
- Form is uncontrolled on submit, resets after success
- On submit → `POST /api/generate` → gets `{ id }` → mounts `GenerationStatus` with that id
- `GenerationStatus` polls `GET /api/songs/[id]` every 2s, renders spinner + elapsed timer (`Date.now() - createdAt`), hides itself when `status` flips to `ready`/`failed`
- On `ready` → calls `loadPlayer(song)` (new song appears in bottom bar), form resets

### Library screen (`/history`)

- Server component: `SELECT * FROM songs ORDER BY created_at DESC` → `SongList` of `SongCard`s
- Each card: prompt (truncated), lyrics preview (2 lines), created time, status badge (`pending`/`ready`/`failed`)
- Click a `ready` card → `loadPlayer(song)` (bottom bar switches, page doesn't change)
- Click a `pending` card → shows `GenerationStatus` inline on the card (one polling hook reused)
- Delete button per card → `DELETE /api/songs/[id]` → optimistic remove from list
- If loaded song is deleted, bar clears

### PlayerBar (sticky bottom)

```
┌───────────────────────────────────────────────────────┐
│ [▶/⏸] [song: prompt]      0:12 / 0:30   ━━━━○━━━━   ⬇│
└───────────────────────────────────────────────────────┘
```

- Native `<audio>` element (hidden), **styled native controls** for v1 (full seek/volume support, less work)
- Track title = song prompt (truncated, tooltip for full)
- Download button → anchor to `/api/audio/[id]` with `download` attribute
- Empty state: "No song loaded"
- If loaded song is deleted from history, bar clears

### Empty states & edge cases

- **Generate with no ACE-Step server:** Submit returns 503 → red error toast "ACE-Step server unreachable. Run `./scripts/start-acestep.sh`." Form stays filled so user can retry.
- **Failed generation:** Card shows red badge with `error` text from ACE-Step; retry button re-submits with same params (new row, new task_id).
- **Audio file missing on disk but DB says ready:** `/api/audio/[id]` returns 404 → PlayerBar shows "File unavailable" state, keeps metadata.

## Configuration

### `.env.local`

```
ACESTEP_API_URL=http://localhost:8001
ACESTEP_API_KEY=               # optional — only if ACE-Step started with a key
```

### `scripts/start-acestep.sh`

Launches ACE-Step API tuned for the 12GB tier:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Assumes ACE-Step-1.5 is cloned at $ACESTEP_DIR (or ../ACE-Step-1.5 by default).
ACESTEP_DIR="${ACESTEP_DIR:-../ACE-Step-1.5}"
cd "$ACESTEP_DIR"

export ACESTEP_CONFIG_PATH=acestep-v15-sft
export ACESTEP_LM_MODEL_PATH=acestep-5Hz-lm-1.7B
export ACESTEP_LM_BACKEND=vllm
export ACESTEP_OFFLOAD_TO_CPU=true
export ACESTEP_INIT_LLM=true
export ACESTEP_API_HOST=127.0.0.1
export ACESTEP_API_PORT=8001
export ACESTEP_API_WORKERS=1

exec uv run acestep-api
```

- `ACESTEP_OFFLOAD_TO_CPU=true` is the critical 12GB flag — without it, the 2B sft + 1.7B LM combo won't fit.
- Models auto-download from HuggingFace on first run (handled by ACE-Step).
- Assumes ACE-Step-1.5 is cloned separately (not vendored into tuneamatic).

### Dependencies (`package.json`)

| Package | Why |
|---|---|
| `next` (App Router) | Framework + API routes |
| `react` / `react-dom` | UI |
| `better-sqlite3` | Sync SQLite, no async overhead, single-process Next.js server |
| `nanoid` | Short unique IDs |
| `typescript` + `@types/*` | Type safety |
| `eslint` / `eslint-config-next` | Lint |
| `vitest` | Test runner (dev dependency) |

**Not included (YAGNI):** UI component library (plain CSS / CSS Modules), state management library (React context suffices), SWR/React Query (polling is one `useEffect` + `setInterval`).

### Commands

- `pnpm dev` → Next.js on `:3000`
- `pnpm build && pnpm start` → production
- `pnpm lint` → ESLint
- `pnpm typecheck` → `tsc --noEmit`
- `pnpm test` → Vitest watch mode
- `pnpm test:run` → single Vitest run (verification)

### `tsconfig.json` key settings

- `strict: true`
- `moduleResolution: "bundler"`
- `paths`: `@/*` → root (Next.js convention)

## Error Handling

| Scenario | Behavior |
|---|---|
| ACE-Step unreachable on `/api/generate` | Return 503, friendly message, no DB row created |
| ACE-Step returns 429 (queue full) | Return 503 "Server busy, try again in a moment", no DB row |
| ACE-Step task fails (`status=2`) | Poller marks row `failed`, stores `error` text from result |
| Audio download from ACE-Step fails (network blip) | Poller retries next cycle (leaves row `pending`); after 3 consecutive failures marks `failed` |
| Audio file missing on disk, DB says `ready` | `/api/audio/[id]` returns 404; frontend shows "File unavailable" |
| Poller crashes mid-download | Row stays `pending`; poller restart picks it up next cycle |
| Two browser tabs submit simultaneously | Each gets unique `id` + `task_id`; both poll independently; no conflict |
| User deletes a `pending` song | DB row deleted; poller won't find it next cycle; ACE-Step task completes but orphaned `task_id` is ignored |
| Next.js dev server HMR / strict mode | Poller guarded by module-level `started` flag — never runs twice per process |
| `next build` without ACE-Step running | Build succeeds (poller only starts at runtime via `instrumentation.ts`) |

## Testing

Pragmatic, not exhaustive — single-user local tool.

| Layer | What | How |
|---|---|---|
| `lib/acestep-client.ts` | Mock ACE-Step HTTP responses, assert payload construction | Vitest + mocked `fetch` |
| `lib/poller.ts` | Given pending rows + mocked ACE-Step responses, assert DB transitions | Vitest + in-memory SQLite (`:memory:`) |
| `lib/db.ts` | Schema migrations, insert/query/delete | Vitest + `:memory:` SQLite |
| API routes | Integration: mock ACE-Step, hit real Next.js route handlers | Vitest + direct handler calls |

**Not tested:** End-to-end real ACE-Step (too slow, needs GPU). Manual smoke test only: run `start-acestep.sh` + `pnpm dev`, submit a short generation, confirm audio plays.

**Not tested for v1:** Frontend UI components.

## Out of Scope (v1)

- User accounts / auth
- Multi-user support
- Editing / cover / repaint / repainting (ACE-Step supports these but we expose only `text2music`)
- LoRA training
- Reference audio input
- Audio understanding / extraction
- Deploying to a remote host (single-machine local only)
- Vendoring ACE-Step-1.5 into this repo (assumed cloned separately)
- Frontend component tests
- UI component library (plain CSS / CSS Modules only)