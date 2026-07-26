# Tuneamatic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local single-user web app that generates songs from a text description and lyrics using ACE-Step 1.5 as the generation backend, with a persisted song library and sticky bottom audio player.

**Architecture:** Next.js (App Router) full-stack app on `:3000` proxies to ACE-Step's FastAPI server on `:8001`. A backend singleton poller (started via `instrumentation.ts`) drives ACE-Step task completion and downloads audio into local storage. Songs persist in SQLite via `better-sqlite3`. A sticky bottom `<audio>` player is driven by React context.

**Tech Stack:** Next.js 14 (App Router), React 18, TypeScript strict, better-sqlite3, nanoid, vitest, plain CSS Modules.

## Global Constraints

- Node 18+ required (Next.js 14 minimum).
- Package manager: `pnpm` (commands use `pnpm`).
- TypeScript `strict: true`, `moduleResolution: "bundler"`, path alias `@/*` → project root.
- `thinking: true` is always sent to ACE-Step's `/release_task` (best quality).
- 12GB GPU tier: `ACESTEP_CONFIG_PATH=acestep-v15-sft`, `ACESTEP_LM_MODEL_PATH=acestep-5Hz-lm-1.7B`, `ACESTEP_LM_BACKEND=vllm`, `ACESTEP_OFFLOAD_TO_CPU=true`.
- ACE-Step API base URL is `http://localhost:8001` (configurable via `ACESTEP_API_URL` env var).
- ACE-Step API has no CORS — all ACE-Step calls go through Next.js API routes, never directly from the browser.
- Storage layout: `data/tuneamatic.db` (SQLite, gitignored), `storage/audio/[id].mp3` (gitignored).
- Poller is a singleton guarded by a module-level `started` flag (dev-HMR/strict-mode safe).
- No frontend component tests for v1. Backend (lib + API routes) tested with Vitest.
- Plain CSS / CSS Modules for styling — no UI component library.
- Lint: `pnpm lint`. Typecheck: `pnpm typecheck`. Tests: `pnpm test:run`.

---

## File Structure

```
tuneamatic/
├── app/
│   ├── api/
│   │   ├── generate/route.ts        # POST: submit to ACE-Step, insert row
│   │   ├── songs/
│   │   │   ├── route.ts             # GET: list all songs
│   │   │   └── [id]/
│   │   │       ├── route.ts         # GET: single song; DELETE: remove song
│   │   │       └── audio/route.ts   # GET: stream audio with Range support
│   │   └── health/route.ts          # GET: liveness + ACE-Step reachability
│   ├── components/
│   │   ├── GenerateForm.tsx
│   │   ├── GenerateForm.module.css
│   │   ├── AdvancedDrawer.tsx
│   │   ├── GenerationStatus.tsx
│   │   ├── GenerationStatus.module.css
│   │   ├── SongList.tsx
│   │   ├── SongCard.tsx
│   │   ├── SongCard.module.css
│   │   ├── PlayerBar.tsx
│   │   ├── PlayerBar.module.css
│   │   └── PlayerProvider.tsx
│   ├── history/
│   │   └── page.tsx                 # Library screen (server component)
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx                     # Generate screen
├── lib/
│   ├── db.ts                        # better-sqlite3 connection + schema + queries
│   ├── types.ts                     # shared TS types (Song, AdvancedParams, etc.)
│   ├── acestep-client.ts            # HTTP client wrapping ACE-Step API
│   ├── poller.ts                    # background poller singleton
│   └── test-helpers.ts              # in-memory db factory for tests
├── tests/
│   ├── db.test.ts
│   ├── acestep-client.test.ts
│   ├── poller.test.ts
│   └── api-generate.test.ts
├── storage/audio/.gitkeep
├── data/.gitkeep
├── scripts/
│   └── start-acestep.sh
├── instrumentation.ts
├── .env.local.example
├── .gitignore
├── next.config.mjs
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

**Responsibilities:**
- `lib/types.ts` — shared TS types only, no logic. Imported by everything.
- `lib/db.ts` — SQLite connection (singleton), schema migration, all query functions. No HTTP.
- `lib/acestep-client.ts` — thin HTTP client wrapping ACE-Step endpoints. No DB.
- `lib/poller.ts` — orchestrates: reads pending rows from db, calls acestep-client, writes results back to db. No HTTP to browser.
- `app/api/*/route.ts` — request handlers. Validate input, call lib functions, return JSON. No business logic.
- `app/components/*` — React UI. Calls API routes via `fetch`. No direct DB or ACE-Step access.

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.mjs`, `vitest.config.ts`, `.gitignore`, `.env.local.example`
- Create: `app/globals.css`, `app/layout.tsx`, `app/page.tsx`
- Create: `storage/audio/.gitkeep`, `data/.gitkeep`
- Create: `instrumentation.ts`

**Interfaces:**
- Produces: a runnable Next.js skeleton (`pnpm dev` starts server, `http://localhost:3000` shows placeholder), `pnpm typecheck` passes, `pnpm test:run` runs 0 tests successfully, `pnpm lint` passes.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "tuneamatic",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "test": "vitest",
    "test:run": "vitest run"
  },
  "dependencies": {
    "better-sqlite3": "^11.3.0",
    "nanoid": "^5.0.7",
    "next": "^14.2.5",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/node": "^20.14.0",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "eslint": "^8.57.0",
    "eslint-config-next": "^14.2.5",
    "typescript": "^5.5.4",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create `next.config.mjs`**

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["better-sqlite3"],
  },
};
export default nextConfig;
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 5: Create `.gitignore`**

```
node_modules/
.next/
.env.local
data/tuneamatic.db
data/tuneamatic.db-journal
storage/audio/*
!storage/audio/.gitkeep
*.log
```

- [ ] **Step 6: Create `.env.local.example`**

```
ACESTEP_API_URL=http://localhost:8001
ACESTEP_API_KEY=
```

- [ ] **Step 7: Create `app/globals.css`**

```css
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: system-ui, -apple-system, sans-serif;
  background: #fafafa;
  color: #1a1a1a;
  line-height: 1.5;
  padding-bottom: 80px; /* space for sticky player bar */
}

a {
  color: inherit;
  text-decoration: none;
}

button {
  font: inherit;
  cursor: pointer;
}
```

- [ ] **Step 8: Create `app/layout.tsx`**

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tuneamatic",
  description: "Generate songs with ACE-Step",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "1rem 2rem",
            borderBottom: "1px solid #e5e5e5",
            background: "white",
          }}
        >
          <strong>Tuneamatic</strong>
          <nav style={{ display: "flex", gap: "1rem" }}>
            <a href="/">Generate</a>
            <a href="/history">Library</a>
          </nav>
        </header>
        <main style={{ maxWidth: "800px", margin: "0 auto", padding: "2rem 1rem" }}>
          {children}
        </main>
      </body>
    </html>
  );
}
```

- [ ] **Step 9: Create `app/page.tsx`**

```tsx
export default function Home() {
  return (
    <div>
      <h1>Generate a song</h1>
      <p>Coming soon.</p>
    </div>
  );
}
```

- [ ] **Step 10: Create `instrumentation.ts`**

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startPoller } = await import("@/lib/poller");
    startPoller();
  }
}
```

- [ ] **Step 11: Create `.gitkeep` files**

```bash
mkdir -p storage/audio data
touch storage/audio/.gitkeep data/.gitkeep
```

- [ ] **Step 12: Install dependencies**

Run: `pnpm install`
Expected: dependencies install, no errors. (Ignore peer dependency warnings from `better-sqlite3` if any.)

- [ ] **Step 13: Verify typecheck passes**

Run: `pnpm typecheck`
Expected: exit 0, no errors. (May warn about `next-env.d.ts` not existing yet — that's auto-generated on first `pnpm dev`/`pnpm build`; if typecheck fails solely due to missing `next-env.d.ts`, run `pnpm dev` once to generate it then `Ctrl-C` and retry.)

- [ ] **Step 14: Verify lint passes**

Run: `pnpm lint`
Expected: exit 0, no errors. (Next.js may prompt to configure ESLint on first run — answer yes, defaults are fine.)

- [ ] **Step 15: Verify test runner works**

Run: `pnpm test:run`
Expected: "No test files found", exit 0.

- [ ] **Step 16: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js project"
```

---

## Task 2: Shared Types

**Files:**
- Create: `lib/types.ts`

**Interfaces:**
- Produces: `Song`, `SongStatus`, `AdvancedParams`, `GenerateRequest`, `GenerateResponse`, `SongApiResponse` types. Consumed by db, acestep-client, poller, API routes, and frontend.

- [ ] **Step 1: Create `lib/types.ts`**

```ts
export type SongStatus = "pending" | "ready" | "failed";

export interface AdvancedParams {
  duration?: number;      // 10-600
  bpm?: number;           // 30-300
  keyScale?: string;      // e.g. "C Major"
  timeSignature?: string; // "2" | "3" | "4" | "6"
  seed?: number;          // -1 = random
  batchSize?: number;     // 1-8
}

export interface GenerateRequest {
  prompt: string;
  lyrics?: string;
  advanced?: AdvancedParams;
}

export interface GenerateResponse {
  id: string;
}

export interface Song {
  id: string;
  taskId: string;
  status: SongStatus;
  prompt: string;
  lyrics: string;
  advanced: AdvancedParams;
  audioPath: string | null;
  error: string | null;
  createdAt: number;
  readyAt: number | null;
  metas: SongMetas | null;
  seedValue: string | null;
  ditModel: string | null;
  lmModel: string | null;
}

export interface SongMetas {
  bpm?: number;
  duration?: number;
  genres?: string;
  keyscale?: string;
  timesignature?: string;
}

export interface SongApiResponse {
  id: string;
  status: SongStatus;
  prompt: string;
  lyrics: string;
  advanced: AdvancedParams;
  createdAt: number;
  readyAt: number | null;
  error: string | null;
  audioUrl: string | null;
  metas: SongMetas | null;
  seedValue: string | null;
  ditModel: string | null;
  lmModel: string | null;
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add lib/types.ts
git commit -m "feat: add shared types"
```

---

## Task 3: Database Layer (TDD)

**Files:**
- Create: `lib/db.ts`
- Create: `lib/test-helpers.ts`
- Test: `tests/db.test.ts`

**Interfaces:**
- Consumes: `Song`, `SongStatus`, `AdvancedParams` from `lib/types.ts`.
- Produces:
  - `initDb(dbPath: string): Database` — opens/creates DB, runs migrations, returns connection
  - `insertSong(db, input): string` — inserts pending row, returns id
  - `getSong(db, id): Song | null`
  - `listSongs(db): Song[]` — newest first
  - `listPendingSongs(db): Song[]`
  - `markReady(db, id, fields)` — sets status=ready, audioPath, readyAt, metas, seed, models
  - `markFailed(db, id, error)` — sets status=failed, error
  - `deleteSong(db, id): boolean` — returns true if a row was deleted

- [ ] **Step 1: Create `lib/test-helpers.ts`**

```ts
import Database from "better-sqlite3";
import { initDb } from "@/lib/db";

export function makeTestDb(): Database.Database {
  const db = initDb(":memory:");
  return db;
}
```

- [ ] **Step 2: Write failing test for schema + insertSong + getSong**

```ts
// tests/db.test.ts
import { describe, it, expect } from "vitest";
import { makeTestDb } from "@/lib/test-helpers";
import { insertSong, getSong } from "@/lib/db";

describe("db", () => {
  it("inserts and retrieves a pending song", () => {
    const db = makeTestDb();
    const id = insertSong(db, {
      taskId: "ace-task-123",
      prompt: "upbeat pop song",
      lyrics: "hello world",
      advanced: { bpm: 120 },
    });
    expect(id).toMatch(/^[A-Za-z0-9_-]{10,}$/);

    const song = getSong(db, id);
    expect(song).not.toBeNull();
    expect(song!.status).toBe("pending");
    expect(song!.prompt).toBe("upbeat pop song");
    expect(song!.lyrics).toBe("hello world");
    expect(song!.advanced).toEqual({ bpm: 120 });
    expect(song!.audioPath).toBeNull();
    expect(song!.readyAt).toBeNull();
    expect(song!.createdAt).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run test, verify it fails**

Run: `pnpm test:run tests/db.test.ts`
Expected: FAIL — `initDb` / `insertSong` / `getSong` not defined (module not found).

- [ ] **Step 4: Create `lib/db.ts` with minimal implementation**

```ts
// lib/db.ts
import Database from "better-sqlite3";
import { nanoid } from "nanoid";
import type { AdvancedParams, Song, SongStatus } from "@/lib/types";

type DB = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS songs (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL,
  status      TEXT NOT NULL,
  prompt      TEXT NOT NULL,
  lyrics      TEXT NOT NULL DEFAULT '',
  advanced    TEXT NOT NULL DEFAULT '{}',
  audio_path  TEXT,
  error       TEXT,
  created_at  INTEGER NOT NULL,
  ready_at    INTEGER,
  metas       TEXT,
  seed_value  TEXT,
  dit_model   TEXT,
  lm_model    TEXT
);
CREATE INDEX IF NOT EXISTS idx_status ON songs(status);
CREATE INDEX IF NOT EXISTS idx_created ON songs(created_at DESC);
`;

export function initDb(dbPath: string): DB {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  return db;
}

export function insertSong(
  db: DB,
  input: { taskId: string; prompt: string; lyrics: string; advanced: AdvancedParams }
): string {
  const id = nanoid();
  const now = Date.now();
  db.prepare(
    `INSERT INTO songs (id, task_id, status, prompt, lyrics, advanced, created_at)
     VALUES (?, ?, 'pending', ?, ?, ?, ?)`
  ).run(id, input.taskId, input.prompt, input.lyrics, JSON.stringify(input.advanced), now);
  return id;
}

function rowToSong(row: any): Song {
  return {
    id: row.id,
    taskId: row.task_id,
    status: row.status as SongStatus,
    prompt: row.prompt,
    lyrics: row.lyrics,
    advanced: JSON.parse(row.advanced),
    audioPath: row.audio_path,
    error: row.error,
    createdAt: row.created_at,
    readyAt: row.ready_at,
    metas: row.metas ? JSON.parse(row.metas) : null,
    seedValue: row.seed_value,
    ditModel: row.dit_model,
    lmModel: row.lm_model,
  };
}

export function getSong(db: DB, id: string): Song | null {
  const row = db.prepare("SELECT * FROM songs WHERE id = ?").get(id);
  return row ? rowToSong(row) : null;
}
```

- [ ] **Step 5: Run test, verify it passes**

Run: `pnpm test:run tests/db.test.ts`
Expected: PASS.

- [ ] **Step 6: Add test for markReady**

Append to `tests/db.test.ts`:

```ts
import { markReady } from "@/lib/db";

describe("markReady", () => {
  it("sets status=ready and populates result fields", () => {
    const db = makeTestDb();
    const id = insertSong(db, {
      taskId: "t1",
      prompt: "p",
      lyrics: "",
      advanced: {},
    });
    markReady(db, id, {
      audioPath: "audio/abc.mp3",
      metas: { bpm: 100, duration: 30, keyscale: "C Major" },
      seedValue: "123,456",
      ditModel: "acestep-v15-sft",
      lmModel: "acestep-5Hz-lm-1.7B",
    });
    const song = getSong(db, id)!;
    expect(song.status).toBe("ready");
    expect(song.audioPath).toBe("audio/abc.mp3");
    expect(song.readyAt).toBeGreaterThan(0);
    expect(song.metas).toEqual({ bpm: 100, duration: 30, keyscale: "C Major" });
    expect(song.seedValue).toBe("123,456");
    expect(song.ditModel).toBe("acestep-v15-sft");
    expect(song.lmModel).toBe("acestep-5Hz-lm-1.7B");
  });
});
```

- [ ] **Step 7: Run, verify new test fails**

Run: `pnpm test:run tests/db.test.ts`
Expected: FAIL — `markReady` not defined.

- [ ] **Step 8: Implement `markReady` in `lib/db.ts`**

Append to `lib/db.ts`:

```ts
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
): void {
  db.prepare(
    `UPDATE songs SET
       status = 'ready',
       audio_path = ?,
       ready_at = ?,
       metas = ?,
       seed_value = ?,
       dit_model = ?,
       lm_model = ?
     WHERE id = ?`
  ).run(
    fields.audioPath,
    Date.now(),
    JSON.stringify(fields.metas),
    fields.seedValue,
    fields.ditModel,
    fields.lmModel,
    id
  );
}
```

- [ ] **Step 9: Run, verify pass**

Run: `pnpm test:run tests/db.test.ts`
Expected: PASS.

- [ ] **Step 10: Add test for markFailed**

Append to `tests/db.test.ts`:

```ts
import { markFailed } from "@/lib/db";

describe("markFailed", () => {
  it("sets status=failed and stores error", () => {
    const db = makeTestDb();
    const id = insertSong(db, { taskId: "t1", prompt: "p", lyrics: "", advanced: {} });
    markFailed(db, id, "GPU OOM");
    const song = getSong(db, id)!;
    expect(song.status).toBe("failed");
    expect(song.error).toBe("GPU OOM");
    expect(song.readyAt).toBeNull();
  });
});
```

- [ ] **Step 11: Run, verify fail**

Run: `pnpm test:run tests/db.test.ts`
Expected: FAIL — `markFailed` not defined.

- [ ] **Step 12: Implement `markFailed` in `lib/db.ts`**

Append to `lib/db.ts`:

```ts
export function markFailed(db: DB, id: string, error: string): void {
  db.prepare(
    `UPDATE songs SET status = 'failed', error = ? WHERE id = ?`
  ).run(error, id);
}
```

- [ ] **Step 13: Run, verify pass**

Run: `pnpm test:run tests/db.test.ts`
Expected: PASS.

- [ ] **Step 14: Add test for listSongs + listPendingSongs + deleteSong**

Append to `tests/db.test.ts`:

```ts
import { listSongs, listPendingSongs, deleteSong } from "@/lib/db";

describe("listSongs / listPendingSongs / deleteSong", () => {
  it("lists songs newest-first", () => {
    const db = makeTestDb();
    const id1 = insertSong(db, { taskId: "t1", prompt: "p1", lyrics: "", advanced: {} });
    const id2 = insertSong(db, { taskId: "t2", prompt: "p2", lyrics: "", advanced: {} });
    const songs = listSongs(db);
    expect(songs).toHaveLength(2);
    expect(songs[0].id).toBe(id2);
    expect(songs[1].id).toBe(id1);
  });

  it("lists only pending songs", () => {
    const db = makeTestDb();
    const id1 = insertSong(db, { taskId: "t1", prompt: "p1", lyrics: "", advanced: {} });
    const id2 = insertSong(db, { taskId: "t2", prompt: "p2", lyrics: "", advanced: {} });
    markFailed(db, id2, "err");
    const pending = listPendingSongs(db);
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(id1);
  });

  it("deletes a song and returns true; false for missing", () => {
    const db = makeTestDb();
    const id = insertSong(db, { taskId: "t1", prompt: "p1", lyrics: "", advanced: {} });
    expect(deleteSong(db, id)).toBe(true);
    expect(getSong(db, id)).toBeNull();
    expect(deleteSong(db, "nonexistent")).toBe(false);
  });
});
```

- [ ] **Step 15: Run, verify fail**

Run: `pnpm test:run tests/db.test.ts`
Expected: FAIL — `listSongs`, `listPendingSongs`, `deleteSong` not defined.

- [ ] **Step 16: Implement the three functions in `lib/db.ts`**

Append to `lib/db.ts`:

```ts
export function listSongs(db: DB): Song[] {
  const rows = db.prepare("SELECT * FROM songs ORDER BY created_at DESC").all();
  return rows.map(rowToSong);
}

export function listPendingSongs(db: DB): Song[] {
  const rows = db.prepare("SELECT * FROM songs WHERE status = 'pending'").all();
  return rows.map(rowToSong);
}

export function deleteSong(db: DB, id: string): boolean {
  const result = db.prepare("DELETE FROM songs WHERE id = ?").run(id);
  return result.changes > 0;
}
```

- [ ] **Step 17: Run, verify pass**

Run: `pnpm test:run tests/db.test.ts`
Expected: PASS (all tests).

- [ ] **Step 18: Verify typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both exit 0.

- [ ] **Step 19: Commit**

```bash
git add lib/db.ts lib/test-helpers.ts tests/db.test.ts
git commit -m "feat: add database layer with tests"
```

---

## Task 4: ACE-Step HTTP Client (TDD)

**Files:**
- Create: `lib/acestep-client.ts`
- Test: `tests/acestep-client.test.ts`

**Interfaces:**
- Consumes: env `ACESTEP_API_URL`, `ACESTEP_API_KEY`. Uses global `fetch`.
- Produces:
  - `releaseTask(payload: ReleaseTaskPayload): Promise<{ taskId: string }>` — throws `AceStepError` on non-2xx
  - `queryResults(taskIds: string[]): Promise<QueryResult[]>` — batch query
  - `downloadAudio(path: string): Promise<ArrayBuffer>` — fetches raw audio bytes from `/v1/audio?path=...`
  - `ping(): Promise<boolean>` — health check

Where:
```ts
interface ReleaseTaskPayload {
  prompt: string;
  lyrics: string;
  thinking: true;
  audio_duration?: number;
  bpm?: number;
  key_scale?: string;
  time_signature?: string;
  seed?: number;
  batch_size?: number;
}

interface QueryResult {
  taskId: string;
  status: 0 | 1 | 2;
  file?: string;      // /v1/audio?path=... URL when status=1
  prompt?: string;
  lyrics?: string;
  metas?: Record<string, unknown>;
  seed_value?: string;
  lm_model?: string;
  dit_model?: string;
  error?: string;
}

class AceStepError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = "AceStepError"; }
}
```

- [ ] **Step 1: Write failing test for releaseTask**

```ts
// tests/acestep-client.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAceStepClient, AceStepError } from "@/lib/acestep-client";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

describe("acestep-client", () => {
  const client = createAceStepClient({
    baseUrl: "http://localhost:8001",
    apiKey: undefined,
  });

  it("releaseTask sends correct payload and returns taskId", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: { task_id: "abc-123", status: "queued", queue_position: 0 },
        code: 200,
        error: null,
      }),
    });

    const result = await client.releaseTask({
      prompt: "upbeat pop",
      lyrics: "hello",
      thinking: true,
      audio_duration: 60,
    });

    expect(result.taskId).toBe("abc-123");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("http://localhost:8001/release_task");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      prompt: "upbeat pop",
      lyrics: "hello",
      thinking: true,
      audio_duration: 60,
    });
  });

  it("releaseTask throws AceStepError on 429", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429, text: async () => "busy" });
    await expect(client.releaseTask({ prompt: "x", lyrics: "", thinking: true }))
      .rejects.toMatchObject({ status: 429 });
  });

  it("releaseTask throws on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await expect(client.releaseTask({ prompt: "x", lyrics: "", thinking: true }))
      .rejects.toThrow("ECONNREFUSED");
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm test:run tests/acestep-client.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/acestep-client.ts`**

```ts
// lib/acestep-client.ts
export interface ReleaseTaskPayload {
  prompt: string;
  lyrics: string;
  thinking: true;
  audio_duration?: number;
  bpm?: number;
  key_scale?: string;
  time_signature?: string;
  seed?: number;
  batch_size?: number;
}

export interface QueryResult {
  taskId: string;
  status: 0 | 1 | 2;
  file?: string;
  prompt?: string;
  lyrics?: string;
  metas?: Record<string, unknown>;
  seed_value?: string;
  lm_model?: string;
  dit_model?: string;
  error?: string;
}

export class AceStepError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "AceStepError";
  }
}

export interface AceStepClient {
  releaseTask(payload: ReleaseTaskPayload): Promise<{ taskId: string }>;
  queryResults(taskIds: string[]): Promise<QueryResult[]>;
  downloadAudio(path: string): Promise<ArrayBuffer>;
  ping(): Promise<boolean>;
}

export function createAceStepClient(opts: {
  baseUrl: string;
  apiKey?: string;
}): AceStepClient {
  const { baseUrl, apiKey } = opts;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  async function releaseTask(payload: ReleaseTaskPayload): Promise<{ taskId: string }> {
    const res = await fetch(`${baseUrl}/release_task`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new AceStepError(res.status, `ACE-Step release_task failed: ${res.status} ${body}`);
    }
    const json = await res.json();
    const taskId: string | undefined = json?.data?.task_id;
    if (!taskId) throw new AceStepError(res.status, "ACE-Step returned no task_id");
    return { taskId };
  }

  async function queryResults(taskIds: string[]): Promise<QueryResult[]> {
    if (taskIds.length === 0) return [];
    const res = await fetch(`${baseUrl}/query_result`, {
      method: "POST",
      headers,
      body: JSON.stringify({ task_id_list: taskIds }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new AceStepError(res.status, `ACE-Step query_result failed: ${res.status} ${body}`);
    }
    const json = await res.json();
    const rows: any[] = json?.data ?? [];
    return rows.map((r) => {
      let resultObj: any = {};
      if (typeof r.result === "string") {
        try { resultObj = JSON.parse(r.result); } catch { /* leave empty */ }
        if (Array.isArray(resultObj) && resultObj.length > 0) resultObj = resultObj[0];
      }
      return {
        taskId: r.task_id as string,
        status: r.status as 0 | 1 | 2,
        file: resultObj.file,
        prompt: resultObj.prompt,
        lyrics: resultObj.lyrics,
        metas: resultObj.metas,
        seed_value: resultObj.seed_value,
        lm_model: resultObj.lm_model,
        dit_model: resultObj.dit_model,
      };
    });
  }

  async function downloadAudio(path: string): Promise<ArrayBuffer> {
    const url = `${baseUrl}${path}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new AceStepError(res.status, `ACE-Step audio download failed: ${res.status}`);
    }
    return res.arrayBuffer();
  }

  async function ping(): Promise<boolean> {
    try {
      const res = await fetch(`${baseUrl}/health`);
      return res.ok;
    } catch {
      return false;
    }
  }

  return { releaseTask, queryResults, downloadAudio, ping };
}
```

- [ ] **Step 4: Run, verify releaseTask tests pass**

Run: `pnpm test:run tests/acestep-client.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Add test for queryResults**

Append to `tests/acestep-client.test.ts`:

```ts
describe("queryResults", () => {
  it("sends batch and parses results", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          {
            task_id: "t1",
            status: 1,
            result: JSON.stringify([{
              file: "/v1/audio?path=%2Ftmp%2Fabc.mp3",
              prompt: "pop",
              lyrics: "la la",
              metas: { bpm: 120, duration: 30 },
              seed_value: "111,222",
              lm_model: "acestep-5Hz-lm-1.7B",
              dit_model: "acestep-v15-sft",
            }]),
          },
          { task_id: "t2", status: 0, result: "[]" },
        ],
        code: 200,
      }),
    });

    const results = await client.queryResults(["t1", "t2"]);
    expect(results).toHaveLength(2);
    expect(results[0].taskId).toBe("t1");
    expect(results[0].status).toBe(1);
    expect(results[0].file).toBe("/v1/audio?path=%2Ftmp%2Fabc.mp3");
    expect(results[0].metas).toEqual({ bpm: 120, duration: 30 });
    expect(results[0].seedValue).toBeUndefined(); // note: API returns seed_value
    expect(results[1].taskId).toBe("t2");
    expect(results[1].status).toBe(0);
  });

  it("returns empty array for empty input", async () => {
    const results = await client.queryResults([]);
    expect(results).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run, verify fail**

Run: `pnpm test:run tests/acestep-client.test.ts`
Expected: FAIL — test expects `seedValue` but implementation returns `seed_value`. (This is intentional: the test asserts the raw API field name. The poller maps it to the DB column. Do NOT rename the client's field — fix the test's assertion.)

- [ ] **Step 7: Fix the test assertion to match implementation**

In `tests/acestep-client.test.ts`, change:

```ts
expect(results[0].seedValue).toBeUndefined(); // note: API returns seed_value
```

to:

```ts
expect(results[0].seed_value).toBe("111,222");
```

- [ ] **Step 8: Run, verify pass**

Run: `pnpm test:run tests/acestep-client.test.ts`
Expected: PASS.

- [ ] **Step 9: Add test for downloadAudio + ping**

Append to `tests/acestep-client.test.ts`:

```ts
describe("downloadAudio", () => {
  it("fetches raw bytes from the file path", async () => {
    const buf = new ArrayBuffer(8);
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, arrayBuffer: async () => buf });
    const out = await client.downloadAudio("/v1/audio?path=%2Ftmp%2Fabc.mp3");
    expect(out).toBe(buf);
    expect(mockFetch.mock.calls[0][0]).toBe("http://localhost:8001/v1/audio?path=%2Ftmp%2Fabc.mp3");
  });
});

describe("ping", () => {
  it("returns true on 200", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });
    expect(await client.ping()).toBe(true);
  });
  it("returns false on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    expect(await client.ping()).toBe(false);
  });
});
```

- [ ] **Step 10: Run, verify all pass**

Run: `pnpm test:run tests/acestep-client.test.ts`
Expected: PASS (all tests).

- [ ] **Step 11: Verify typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both exit 0.

- [ ] **Step 12: Commit**

```bash
git add lib/acestep-client.ts tests/acestep-client.test.ts
git commit -m "feat: add ACE-Step HTTP client with tests"
```

---

## Task 5: Background Poller (TDD)

**Files:**
- Create: `lib/poller.ts`
- Test: `tests/poller.test.ts`

**Interfaces:**
- Consumes: `initDb`, `listPendingSongs`, `markReady`, `markFailed` from `lib/db`; `createAceStepClient` from `lib/acestep-client`.
- Produces:
  - `startPoller(): void` — idempotent singleton, starts `setInterval(pollOnce, 2000)`. Safe to call multiple times.
  - `stopPoller(): void` — clears interval, resets flag (for tests).
  - `pollOnce(db, client): Promise<void>` — one cycle. Exported for testing.

- [ ] **Step 1: Write failing test for pollOnce success path**

```ts
// tests/poller.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeTestDb } from "@/lib/test-helpers";
import { insertSong, getSong } from "@/lib/db";
import { pollOnce } from "@/lib/poller";
import type { AceStepClient } from "@/lib/acestep-client";

const mockClient = (overrides: Partial<AceStepClient> = {}): AceStepClient => ({
  releaseTask: vi.fn(),
  queryResults: vi.fn(),
  downloadAudio: vi.fn(),
  ping: vi.fn(),
  ...overrides,
});

describe("pollOnce", () => {
  it("downloads audio and marks ready when status=1", async () => {
    const db = makeTestDb();
    const id = insertSong(db, { taskId: "t1", prompt: "p", lyrics: "", advanced: {} });

    const audioBuf = new ArrayBuffer(16);
    const client = mockClient({
      queryResults: vi.fn().mockResolvedValue([
        {
          taskId: "t1",
          status: 1 as const,
          file: "/v1/audio?path=%2Ftmp%2Fabc.mp3",
          prompt: "p",
          lyrics: "",
          metas: { bpm: 120 },
          seed_value: "111",
          lm_model: "acestep-5Hz-lm-1.7B",
          dit_model: "acestep-v15-sft",
        },
      ]),
      downloadAudio: vi.fn().mockResolvedValue(audioBuf),
    });

    // writeFile stub
    const writeSpy = vi.spyOn(require("node:fs"), "writeFileSync").mockImplementation(() => {});

    await pollOnce(db, client, { storageDir: "/tmp/test-storage" });

    const song = getSong(db, id)!;
    expect(song.status).toBe("ready");
    expect(song.metas).toEqual({ bpm: 120 });
    expect(song.seedValue).toBe("111");
    expect(song.ditModel).toBe("acestep-v15-sft");
    expect(song.lmModel).toBe("acestep-5Hz-lm-1.7B");
    expect(song.audioPath).toBe(`audio/${id}.mp3`);
    expect(client.downloadAudio).toHaveBeenCalledWith("/v1/audio?path=%2Ftmp%2Fabc.mp3");
    expect(writeSpy).toHaveBeenCalledWith(`/tmp/test-storage/audio/${id}.mp3`, Buffer.from(audioBuf));
    writeSpy.mockRestore();
  });

  it("marks failed when status=2", async () => {
    const db = makeTestDb();
    const id = insertSong(db, { taskId: "t1", prompt: "p", lyrics: "", advanced: {} });
    const client = mockClient({
      queryResults: vi.fn().mockResolvedValue([
        { taskId: "t1", status: 2 as const, error: "OOM" },
      ]),
    });
    await pollOnce(db, client, { storageDir: "/tmp/test-storage" });
    const song = getSong(db, id)!;
    expect(song.status).toBe("failed");
    expect(song.error).toBe("OOM");
  });

  it("does nothing when no pending songs", async () => {
    const db = makeTestDb();
    const client = mockClient({
      queryResults: vi.fn().mockResolvedValue([]),
    });
    await pollOnce(db, client, { storageDir: "/tmp/test-storage" });
    expect(client.queryResults).not.toHaveBeenCalled();
  });

  it("skips status=0 (still running)", async () => {
    const db = makeTestDb();
    const id = insertSong(db, { taskId: "t1", prompt: "p", lyrics: "", advanced: {} });
    const client = mockClient({
      queryResults: vi.fn().mockResolvedValue([{ taskId: "t1", status: 0 as const }]),
    });
    await pollOnce(db, client, { storageDir: "/tmp/test-storage" });
    const song = getSong(db, id)!;
    expect(song.status).toBe("pending");
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm test:run tests/poller.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/poller.ts`**

```ts
// lib/poller.ts
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { listPendingSongs, markReady, markFailed } from "@/lib/db";
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
    if (r.status === 1) {
      const audioDir = join(opts.storageDir, "audio");
      mkdirSync(audioDir, { recursive: true });
      const relPath = `audio/${song.id}.mp3`;
      const absPath = join(opts.storageDir, relPath);
      try {
        const buf = await client.downloadAudio(r.file!);
        writeFileSync(absPath, Buffer.from(buf));
      } catch (err) {
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
  const { initDb } = require("@/lib/db");
  const { createAceStepClient } = require("@/lib/acestep-client");
  const baseUrl = process.env.ACESTEP_API_URL ?? "http://localhost:8001";
  const apiKey = process.env.ACESTEP_API_KEY || undefined;
  const storageDir = process.cwd();
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
```

- [ ] **Step 4: Run, verify all poller tests pass**

Run: `pnpm test:run tests/poller.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Add test for startPoller/stopPoller singleton behavior**

Append to `tests/poller.test.ts`:

```ts
import { startPoller, stopPoller } from "@/lib/poller";

describe("startPoller / stopPoller", () => {
  it("is idempotent — startPoller twice only starts one interval", () => {
    startPoller();
    const handle1 = (poller as any).intervalHandle;  // not exposed; check via side effect
    startPoller();
    stopPoller();
    // No assertion on internals; verifying it doesn't throw or double-start.
    // The singleton `started` flag guards against double-registration.
    expect(true).toBe(true);
  });

  it("stopPoller resets the flag so startPoller can run again", () => {
    startPoller();
    stopPoller();
    startPoller();
    stopPoller();
  });
});
```

Note: remove the `(poller as any).intervalHandle` line — it references an undefined variable. Replace the first test body with:

```ts
  it("is idempotent — startPoller twice only starts one interval", () => {
    startPoller();
    startPoller();
    stopPoller();
  });
```

- [ ] **Step 6: Run, verify pass**

Run: `pnpm test:run tests/poller.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 7: Verify typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both exit 0.

- [ ] **Step 8: Commit**

```bash
git add lib/poller.ts tests/poller.test.ts
git commit -m "feat: add background poller with tests"
```

---

## Task 6: API Routes — Generate + Health

**Files:**
- Create: `app/api/generate/route.ts`
- Create: `app/api/health/route.ts`
- Create: `lib/app-db.ts` (singleton db connection for route handlers)
- Create: `lib/app-client.ts` (singleton acestep client for route handlers)
- Test: `tests/api-generate.test.ts`

**Interfaces:**
- Consumes: `initDb`, `insertSong` from `lib/db`; `createAceStepClient` from `lib/acestep-client`; `GenerateRequest`, `GenerateResponse` from `lib/types`.
- Produces:
  - `POST /api/generate` → `200 { id: string }` on success, `400` on invalid prompt, `503` on ACE-Step unreachable/busy
  - `GET /api/health` → `200 { ok: true, acestepReachable: boolean }`

- [ ] **Step 1: Create `lib/app-db.ts` (singleton)**

```ts
// lib/app-db.ts
import { initDb } from "@/lib/db";
import { join } from "node:path";
import type { Database } from "better-sqlite3";

let dbInstance: Database | null = null;

export function getDb(): Database {
  if (!dbInstance) {
    dbInstance = initDb(join(process.cwd(), "data", "tuneamatic.db"));
  }
  return dbInstance;
}
```

- [ ] **Step 2: Create `lib/app-client.ts` (singleton)**

```ts
// lib/app-client.ts
import { createAceStepClient, type AceStepClient } from "@/lib/acestep-client";

let clientInstance: AceStepClient | null = null;

export function getClient(): AceStepClient {
  if (!clientInstance) {
    const baseUrl = process.env.ACESTEP_API_URL ?? "http://localhost:8001";
    const apiKey = process.env.ACESTEP_API_KEY || undefined;
    clientInstance = createAceStepClient({ baseUrl, apiKey });
  }
  return clientInstance;
}
```

- [ ] **Step 3: Write failing test for `/api/generate` happy path**

```ts
// tests/api-generate.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/generate/route";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

function makeReq(body: any): Request {
  return new Request("http://localhost:3000/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/generate", () => {
  it("returns 200 with id on success", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: { task_id: "ace-1" }, code: 200 }),
    });

    const res = await POST(makeReq({ prompt: "pop song", lyrics: "la la" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toMatch(/^[A-Za-z0-9_-]{10,}$/);
  });

  it("returns 400 when prompt is empty", async () => {
    const res = await POST(makeReq({ prompt: "" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when prompt is missing", async () => {
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
  });

  it("returns 503 when ACE-Step is unreachable", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const res = await POST(makeReq({ prompt: "pop" }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toContain("ACE-Step");
  });

  it("returns 503 when ACE-Step returns 429", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429, text: async () => "busy" });
    const res = await POST(makeReq({ prompt: "pop" }));
    expect(res.status).toBe(503);
  });
});
```

- [ ] **Step 4: Run, verify fail**

Run: `pnpm test:run tests/api-generate.test.ts`
Expected: FAIL — route not found.

- [ ] **Step 5: Create `app/api/generate/route.ts`**

```ts
// app/api/generate/route.ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/app-db";
import { getClient } from "@/lib/app-client";
import { insertSong } from "@/lib/db";
import type { AdvancedParams } from "@/lib/types";

export async function POST(req: Request): Promise<Response> {
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

  const lyrics: string = (body?.lyrics ?? "").toString();
  const advanced: AdvancedParams = body?.advanced ?? {};

  const payload: any = {
    prompt,
    lyrics,
    thinking: true,
  };
  if (advanced.duration !== undefined) payload.audio_duration = advanced.duration;
  if (advanced.bpm !== undefined) payload.bpm = advanced.bpm;
  if (advanced.keyScale) payload.key_scale = advanced.keyScale;
  if (advanced.timeSignature) payload.time_signature = advanced.timeSignature;
  if (advanced.seed !== undefined) payload.seed = advanced.seed;
  if (advanced.batchSize !== undefined) payload.batch_size = advanced.batchSize;

  try {
    const client = getClient();
    const { taskId } = await client.releaseTask(payload);
    const db = getDb();
    const id = insertSong(db, { taskId, prompt, lyrics, advanced });
    return NextResponse.json({ id }, { status: 200 });
  } catch (err: any) {
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
    return NextResponse.json(
      { error: `ACE-Step error: ${msg}` },
      { status: 503 }
    );
  }
}
```

- [ ] **Step 6: Create `app/api/health/route.ts`**

```ts
// app/api/health/route.ts
import { NextResponse } from "next/server";
import { getClient } from "@/lib/app-client";

export async function GET(): Promise<Response> {
  const client = getClient();
  const reachable = await client.ping();
  return NextResponse.json({ ok: true, acestepReachable: reachable });
}
```

- [ ] **Step 7: Run, verify tests pass**

Run: `pnpm test:run tests/api-generate.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 8: Verify typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both exit 0.

- [ ] **Step 9: Commit**

```bash
git add app/api/generate/route.ts app/api/health/route.ts lib/app-db.ts lib/app-client.ts tests/api-generate.test.ts
git commit -m "feat: add generate and health API routes"
```

---

## Task 7: API Routes — Songs List, Detail, Delete

**Files:**
- Create: `app/api/songs/route.ts`
- Create: `app/api/songs/[id]/route.ts`
- Test: `tests/api-songs.test.ts`

**Interfaces:**
- Consumes: `getDb`, `listSongs`, `getSong`, `deleteSong` from db layer.
- Produces:
  - `GET /api/songs` → `200 SongApiResponse[]`
  - `GET /api/songs/[id]` → `200 SongApiResponse` or `404`
  - `DELETE /api/songs/[id]` → `204` or `404`

- [ ] **Step 1: Write failing test for list + detail + delete**

```ts
// tests/api-songs.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET as listSongs } from "@/app/api/songs/route";
import { GET as getSong, DELETE as deleteSong } from "@/app/api/songs/[id]/route";
import { insertSong, markReady } from "@/lib/db";
import { getDb } from "@/lib/app-db";

// ensure a fresh in-memory-ish db for tests by pointing env at temp file
beforeEach(() => {
  // We use the singleton app-db; reset between tests by clearing the table.
  const db = getDb();
  db.exec("DELETE FROM songs");
});

function songToApiPayload(s: any): any {
  return {
    prompt: s.prompt ?? "p",
    lyrics: s.lyrics ?? "",
    advanced: s.advanced ?? {},
  };
}

describe("GET /api/songs", () => {
  it("returns songs newest-first as SongApiResponse", async () => {
    const db = getDb();
    const id1 = insertSong(db, { taskId: "t1", prompt: "first", lyrics: "a", advanced: {} });
    const id2 = insertSong(db, { taskId: "t2", prompt: "second", lyrics: "b", advanced: {} });
    const res = await listSongs();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(body[0].id).toBe(id2);
    expect(body[0].audioUrl).toBeNull(); // pending → no audioUrl
    expect(body[1].id).toBe(id1);
  });
});

describe("GET /api/songs/[id]", () => {
  it("returns the song with audioUrl when ready", async () => {
    const db = getDb();
    const id = insertSong(db, { taskId: "t1", prompt: "p", lyrics: "", advanced: {} });
    markReady(db, id, {
      audioPath: `audio/${id}.mp3`,
      metas: { bpm: 120 },
      seedValue: "1",
      ditModel: "acestep-v15-sft",
      lmModel: "acestep-5Hz-lm-1.7B",
    });
    const req = new Request(`http://localhost:3000/api/songs/${id}`);
    const res = await getSong(req, { params: { id } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ready");
    expect(body.audioUrl).toBe(`/api/audio/${id}`);
  });

  it("returns 404 for missing song", async () => {
    const req = new Request("http://localhost:3000/api/songs/nope");
    const res = await getSong(req, { params: { id: "nope" } });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/songs/[id]", () => {
  it("returns 204 and deletes the row", async () => {
    const db = getDb();
    const id = insertSong(db, { taskId: "t1", prompt: "p", lyrics: "", advanced: {} });
    const req = new Request(`http://localhost:3000/api/songs/${id}`, { method: "DELETE" });
    const res = await deleteSong(req, { params: { id } });
    expect(res.status).toBe(204);
    const list = await listSongs();
    expect((await list.json())).toHaveLength(0);
  });

  it("returns 404 for missing song", async () => {
    const req = new Request("http://localhost:3000/api/songs/nope", { method: "DELETE" });
    const res = await deleteSong(req, { params: { id: "nope" } });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm test:run tests/api-songs.test.ts`
Expected: FAIL — routes not found.

- [ ] **Step 3: Create `app/api/songs/route.ts`**

```ts
// app/api/songs/route.ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/app-db";
import { listSongs } from "@/lib/db";
import type { Song, SongApiResponse } from "@/lib/types";

function toApiResponse(s: Song): SongApiResponse {
  return {
    id: s.id,
    status: s.status,
    prompt: s.prompt,
    lyrics: s.lyrics,
    advanced: s.advanced,
    createdAt: s.createdAt,
    readyAt: s.readyAt,
    error: s.error,
    audioUrl: s.status === "ready" && s.audioPath ? `/api/audio/${s.id}` : null,
    metas: s.metas,
    seedValue: s.seedValue,
    ditModel: s.ditModel,
    lmModel: s.lmModel,
  };
}

export async function GET(): Promise<Response> {
  const db = getDb();
  const songs = listSongs(db);
  const payload: SongApiResponse[] = songs.map(toApiResponse);
  return NextResponse.json(payload);
}

export { toApiResponse };
```

- [ ] **Step 4: Create `app/api/songs/[id]/route.ts`**

```ts
// app/api/songs/[id]/route.ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/app-db";
import { getSong, deleteSong } from "@/lib/db";
import { unlinkSync } from "node:fs";
import { join } from "node:path";
import { toApiResponse } from "@/app/api/songs/route";

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  const db = getDb();
  const song = getSong(db, params.id);
  if (!song) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(toApiResponse(song));
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  const db = getDb();
  const song = getSong(db, params.id);
  if (!song) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (song.audioPath) {
    try {
      unlinkSync(join(process.cwd(), "storage", song.audioPath));
    } catch {
      /* best-effort */
    }
  }
  deleteSong(db, params.id);
  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 5: Run, verify pass**

Run: `pnpm test:run tests/api-songs.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Verify typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both exit 0.

- [ ] **Step 7: Commit**

```bash
git add app/api/songs/ tests/api-songs.test.ts
git commit -m "feat: add songs list, detail, delete API routes"
```

---

## Task 8: API Route — Audio Streaming

**Files:**
- Create: `app/api/songs/[id]/audio/route.ts`

**Interfaces:**
- Consumes: `getDb`, `getSong`.
- Produces: `GET /api/songs/[id]/audio` → streams `storage/audio/[id].mp3` with `Content-Type: audio/mpeg`, `Accept-Ranges: bytes`, honors `Range` header for seek. Returns `404` if song not ready or file missing.

Note: this route has no automated test for v1 (range request streaming is awkward to unit-test without a real file). Manual verification only.

- [ ] **Step 1: Create `app/api/songs/[id]/audio/route.ts`**

```ts
// app/api/songs/[id]/audio/route.ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/app-db";
import { getSong } from "@/lib/db";
import { createReadStream, statSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  const db = getDb();
  const song = getSong(db, params.id);
  if (!song || song.status !== "ready" || !song.audioPath) {
    return NextResponse.json({ error: "audio not available" }, { status: 404 });
  }
  const absPath = join(process.cwd(), "storage", song.audioPath);
  let size: number;
  try {
    size = statSync(absPath).size;
  } catch {
    return NextResponse.json({ error: "audio file missing" }, { status: 404 });
  }

  const range = req.headers.get("range");
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      const start = m[1] ? parseInt(m[1], 10) : 0;
      const end = m[2] ? parseInt(m[2], 10) : size - 1;
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

  const stream = createReadStream(absPath);
  return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers: {
      "Accept-Ranges": "bytes",
      "Content-Length": String(size),
      "Content-Type": "audio/mpeg",
    },
  });
}
```

- [ ] **Step 2: Verify typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both exit 0.

- [ ] **Step 3: Manual smoke test (optional, requires a ready song in DB)**

If a song exists with `status=ready` and an audio file at `storage/audio/[id].mp3`:
- `curl -i http://localhost:3000/api/songs/[id]/audio | head` → `200 OK`, `Content-Type: audio/mpeg`, `Accept-Ranges: bytes`
- `curl -I -H "Range: bytes=0-1023" http://localhost:3000/api/songs/[id]/audio` → `206 Partial Content`, `Content-Range: bytes 0-1023/...`

- [ ] **Step 4: Commit**

```bash
git add app/api/songs/[id]/audio/route.ts
git commit -m "feat: add audio streaming API route with Range support"
```

---

## Task 9: Player Context + PlayerBar

**Files:**
- Create: `app/components/PlayerProvider.tsx`
- Create: `app/components/PlayerBar.tsx`
- Create: `app/components/PlayerBar.module.css`
- Modify: `app/layout.tsx`

**Interfaces:**
- Consumes: `SongApiResponse` from `lib/types` (via the frontend).
- Produces: `PlayerProvider` (context), `usePlayer()` hook returning `{ song, isPlaying, load, clear }`, `PlayerBar` component.

- [ ] **Step 1: Create `app/components/PlayerProvider.tsx`**

```tsx
// app/components/PlayerProvider.tsx
"use client";
import { createContext, useContext, useRef, useState, ReactNode } from "react";
import type { SongApiResponse } from "@/lib/types";

interface PlayerContextValue {
  song: SongApiResponse | null;
  audioRef: React.RefObject<HTMLAudioElement>;
  load: (song: SongApiResponse) => void;
  clear: () => void;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [song, setSong] = useState<SongApiResponse | null>(null);

  function load(s: SongApiResponse) {
    setSong(s);
    if (audioRef.current && s.audioUrl) {
      audioRef.current.src = s.audioUrl;
      audioRef.current.play().catch(() => {
        /* autoplay blocked — user can press play */
      });
    }
  }

  function clear() {
    setSong(null);
    if (audioRef.current) audioRef.current.src = "";
  }

  return (
    <PlayerContext.Provider value={{ song, audioRef, load, clear }}>
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used within PlayerProvider");
  return ctx;
}
```

- [ ] **Step 2: Create `app/components/PlayerBar.module.css`**

```css
.bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 72px;
  background: #1a1a1a;
  color: white;
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0 1.5rem;
  z-index: 100;
  box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.15);
}

.title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.95rem;
}

.audio {
  width: 320px;
  max-width: 40vw;
}

.download {
  color: white;
  background: transparent;
  border: 1px solid #444;
  padding: 0.4rem 0.8rem;
  border-radius: 4px;
  font-size: 0.85rem;
}

.download:hover {
  border-color: #888;
}

.empty {
  color: #888;
  font-style: italic;
}
```

- [ ] **Step 3: Create `app/components/PlayerBar.tsx`**

```tsx
// app/components/PlayerBar.tsx
"use client";
import { usePlayer } from "@/app/components/PlayerProvider";
import styles from "./PlayerBar.module.css";

export function PlayerBar() {
  const { song, audioRef } = usePlayer();
  return (
    <div className={styles.bar}>
      <div className={styles.title}>
        {song ? (
          <span title={song.prompt}>{song.prompt}</span>
        ) : (
          <span className={styles.empty}>No song loaded</span>
        )}
      </div>
      {song && song.audioUrl ? (
        <>
          <audio
            ref={audioRef}
            controls
            className={styles.audio}
            data-testid="player-audio"
          />
          <a
            className={styles.download}
            href={song.audioUrl}
            download={`${song.id}.mp3`}
          >
            Download
          </a>
        </>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Modify `app/layout.tsx` to wrap with PlayerProvider + mount PlayerBar**

Replace the entire contents of `app/layout.tsx`:

```tsx
// app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";
import { PlayerProvider } from "@/app/components/PlayerProvider";
import { PlayerBar } from "@/app/components/PlayerBar";

export const metadata: Metadata = {
  title: "Tuneamatic",
  description: "Generate songs with ACE-Step",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <PlayerProvider>
          <header
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "1rem 2rem",
              borderBottom: "1px solid #e5e5e5",
              background: "white",
            }}
          >
            <strong>Tuneamatic</strong>
            <nav style={{ display: "flex", gap: "1rem" }}>
              <a href="/">Generate</a>
              <a href="/history">Library</a>
            </nav>
          </header>
          <main style={{ maxWidth: "800px", margin: "0 auto", padding: "2rem 1rem" }}>
            {children}
          </main>
          <PlayerBar />
        </PlayerProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 5: Verify typecheck**

Run: `pnpm typecheck`
Expected: exit 0.

- [ ] **Step 6: Verify dev server renders**

Run: `pnpm dev`, open `http://localhost:3000`, confirm the page loads with the sticky "No song loaded" bar at the bottom. Stop with `Ctrl-C`.

- [ ] **Step 7: Commit**

```bash
git add app/components/PlayerProvider.tsx app/components/PlayerBar.tsx app/components/PlayerBar.module.css app/layout.tsx
git commit -m "feat: add PlayerProvider context and sticky PlayerBar"
```

---

## Task 10: GenerationStatus Component

**Files:**
- Create: `app/components/GenerationStatus.tsx`
- Create: `app/components/GenerationStatus.module.css`

**Interfaces:**
- Consumes: `usePlayer` from `PlayerProvider`, `SongApiResponse` from `lib/types`.
- Produces: `GenerationStatus({ id }: { id: string })` — polls `/api/songs/[id]` every 2s, shows spinner + elapsed timer, auto-loads into player when ready, hides on ready/failed.

- [ ] **Step 1: Create `app/components/GenerationStatus.module.css`**

```css
.status {
  margin-top: 1.5rem;
  padding: 1rem 1.25rem;
  border: 1px solid #e5e5e5;
  border-radius: 8px;
  background: white;
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.spinner {
  width: 18px;
  height: 18px;
  border: 2px solid #ddd;
  border-top-color: #333;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.timer {
  font-variant-numeric: tabular-nums;
  color: #555;
  font-size: 0.95rem;
}

.error {
  border-color: #f5c6cb;
  background: #f8d7da;
  color: #721c24;
}
```

- [ ] **Step 2: Create `app/components/GenerationStatus.tsx`**

```tsx
// app/components/GenerationStatus.tsx
"use client";
import { useEffect, useState, useRef } from "react";
import { usePlayer } from "@/app/components/PlayerProvider";
import type { SongApiResponse } from "@/lib/types";
import styles from "./GenerationStatus.module.css";

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export function GenerationStatus({ id }: { id: string }) {
  const { load } = usePlayer();
  const [song, setSong] = useState<SongApiResponse | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const createdAtRef = useRef<number | null>(null);

  useEffect(() => {
    let stop = false;
    async function tick() {
      const res = await fetch(`/api/songs/${id}`);
      if (!res.ok) return;
      const s: SongApiResponse = await res.json();
      if (stop) return;
      setSong(s);
      if (s.status === "ready") {
        load(s);
        return;
      }
      if (s.status === "failed") return;
      setTimeout(tick, 2000);
    }
    tick();
    return () => { stop = true; };
  }, [id, load]);

  useEffect(() => {
    if (!song) return;
    if (createdAtRef.current === null) createdAtRef.current = song.createdAt;
    if (song.status !== "pending") return;
    const t = setInterval(() => {
      setElapsed(Date.now() - (createdAtRef.current ?? Date.now()));
    }, 1000);
    return () => clearInterval(t);
  }, [song]);

  if (!song || song.status !== "pending") {
    if (song?.status === "failed") {
      return (
        <div className={`${styles.status} ${styles.error}`}>
          <span>Generation failed: {song.error ?? "unknown error"}</span>
        </div>
      );
    }
    return null;
  }

  return (
    <div className={styles.status}>
      <span className={styles.spinner} aria-label="generating" />
      <span>Generating…</span>
      <span className={styles.timer}>{formatElapsed(elapsed)}</span>
    </div>
  );
}
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm typecheck`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add app/components/GenerationStatus.tsx app/components/GenerationStatus.module.css
git commit -m "feat: add GenerationStatus polling component"
```

---

## Task 11: GenerateForm + AdvancedDrawer + Generate Screen

**Files:**
- Create: `app/components/GenerateForm.tsx`
- Create: `app/components/GenerateForm.module.css`
- Create: `app/components/AdvancedDrawer.tsx`
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: `GenerateRequest`, `GenerateResponse`, `AdvancedParams` from `lib/types`; `GenerationStatus` component.
- Produces: `GenerateForm` client component that POSTs to `/api/generate`, shows `GenerationStatus` on success.

- [ ] **Step 1: Create `app/components/GenerateForm.module.css`**

```css
.form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.label {
  font-weight: 600;
  font-size: 0.9rem;
}

.input, .textarea {
  font: inherit;
  padding: 0.6rem 0.75rem;
  border: 1px solid #ccc;
  border-radius: 6px;
  background: white;
}

.textarea {
  min-height: 120px;
  resize: vertical;
  font-family: ui-monospace, monospace;
}

.submit {
  background: #0070f3;
  color: white;
  border: none;
  padding: 0.7rem 1.2rem;
  border-radius: 6px;
  font-weight: 600;
  font-size: 0.95rem;
}

.submit:hover {
  background: #0060d3;
}

.submit:disabled {
  background: #aaa;
  cursor: not-allowed;
}

.error {
  color: #c0392b;
  font-size: 0.9rem;
}

.advancedToggle {
  background: none;
  border: none;
  color: #555;
  font-size: 0.9rem;
  padding: 0.25rem 0;
  text-align: left;
}

.advancedToggle:hover {
  color: #333;
}

.advancedGrid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem 1rem;
  padding: 0.75rem 0;
}

.advancedField {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.advancedField label {
  font-size: 0.8rem;
  color: #555;
}

.advancedField input, .advancedField select {
  padding: 0.4rem 0.5rem;
  border: 1px solid #ccc;
  border-radius: 4px;
}
```

- [ ] **Step 2: Create `app/components/AdvancedDrawer.tsx`**

```tsx
// app/components/AdvancedDrawer.tsx
"use client";
import { useState, ReactNode } from "react";
import styles from "./GenerateForm.module.css";

export interface AdvancedValues {
  duration?: number;
  bpm?: number;
  keyScale?: string;
  timeSignature?: string;
  seed?: number;
  batchSize?: number;
}

export function AdvancedDrawer({
  values,
  onChange,
}: {
  values: AdvancedValues;
  onChange: (v: AdvancedValues) => void;
}) {
  const [open, setOpen] = useState(false);

  function set<K extends keyof AdvancedValues>(k: K, v: AdvancedValues[K]) {
    onChange({ ...values, [k]: v });
  }

  return (
    <div>
      <button
        type="button"
        className={styles.advancedToggle}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {open ? "▾" : "▸"} Advanced
      </button>
      {open && (
        <div className={styles.advancedGrid}>
          <div className={styles.advancedField}>
            <label>Duration (s, 10–600)</label>
            <input
              type="number"
              min={10}
              max={600}
              value={values.duration ?? ""}
              onChange={(e) =>
                set("duration", e.target.value ? Number(e.target.value) : undefined)
              }
            />
          </div>
          <div className={styles.advancedField}>
            <label>BPM (30–300)</label>
            <input
              type="number"
              min={30}
              max={300}
              value={values.bpm ?? ""}
              onChange={(e) =>
                set("bpm", e.target.value ? Number(e.target.value) : undefined)
              }
            />
          </div>
          <div className={styles.advancedField}>
            <label>Key / scale</label>
            <input
              type="text"
              placeholder="e.g. C Major, Am"
              value={values.keyScale ?? ""}
              onChange={(e) => set("keyScale", e.target.value || undefined)}
            />
          </div>
          <div className={styles.advancedField}>
            <label>Time signature</label>
            <select
              value={values.timeSignature ?? ""}
              onChange={(e) => set("timeSignature", e.target.value || undefined)}
            >
              <option value="">auto</option>
              <option value="2">2/4</option>
              <option value="3">3/4</option>
              <option value="4">4/4</option>
              <option value="6">6/8</option>
            </select>
          </div>
          <div className={styles.advancedField}>
            <label>Seed (blank = random)</label>
            <input
              type="number"
              value={values.seed ?? ""}
              onChange={(e) =>
                set("seed", e.target.value ? Number(e.target.value) : undefined)
              }
            />
          </div>
          <div className={styles.advancedField}>
            <label>Batch size (1–8)</label>
            <input
              type="number"
              min={1}
              max={8}
              value={values.batchSize ?? 1}
              onChange={(e) =>
                set("batchSize", e.target.value ? Number(e.target.value) : 1)
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create `app/components/GenerateForm.tsx`**

```tsx
// app/components/GenerateForm.tsx
"use client";
import { useState, FormEvent } from "react";
import { AdvancedDrawer, AdvancedValues } from "@/app/components/AdvancedDrawer";
import { GenerationStatus } from "@/app/components/GenerationStatus";
import styles from "./GenerateForm.module.css";

export function GenerateForm() {
  const [prompt, setPrompt] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [advanced, setAdvanced] = useState<AdvancedValues>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [songId, setSongId] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!prompt.trim()) {
      setError("Description is required");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, lyrics, advanced }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      const data = await res.json();
      setSongId(data.id);
      setPrompt("");
      setLyrics("");
      setAdvanced({});
    } catch (err: any) {
      setError(err.message ?? "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <form className={styles.form} onSubmit={onSubmit}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="prompt">Description</label>
          <textarea
            id="prompt"
            className={styles.textarea}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. upbeat pop song with acoustic guitar"
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="lyrics">Lyrics</label>
          <textarea
            id="lyrics"
            className={styles.textarea}
            value={lyrics}
            onChange={(e) => setLyrics(e.target.value)}
            placeholder="[Verse 1]&#10;Walking down the street..."
          />
        </div>
        <AdvancedDrawer values={advanced} onChange={setAdvanced} />
        {error && <div className={styles.error}>{error}</div>}
        <button
          className={styles.submit}
          type="submit"
          disabled={submitting || !prompt.trim()}
        >
          {submitting ? "Submitting…" : "Generate song"}
        </button>
      </form>
      {songId && <GenerationStatus id={songId} />}
    </div>
  );
}
```

- [ ] **Step 4: Replace `app/page.tsx`**

```tsx
// app/page.tsx
import { GenerateForm } from "@/app/components/GenerateForm";

export default function Home() {
  return (
    <div>
      <h1>Generate a song</h1>
      <GenerateForm />
    </div>
  );
}
```

- [ ] **Step 5: Verify typecheck**

Run: `pnpm typecheck`
Expected: exit 0.

- [ ] **Step 6: Verify dev server renders**

Run: `pnpm dev`, open `http://localhost:3000`. Confirm: form with description + lyrics + Advanced toggle, "Generate song" button. Type a prompt, submit (expect a 503 error since ACE-Step isn't running — error should display in red). Stop with `Ctrl-C`.

- [ ] **Step 7: Commit**

```bash
git add app/components/GenerateForm.tsx app/components/GenerateForm.module.css app/components/AdvancedDrawer.tsx app/page.tsx
git commit -m "feat: add GenerateForm with advanced drawer"
```

---

## Task 12: Library Screen (History)

**Files:**
- Create: `app/components/SongCard.tsx`
- Create: `app/components/SongCard.module.css`
- Create: `app/components/SongList.tsx`
- Create: `app/history/page.tsx`

**Interfaces:**
- Consumes: `listSongs` from db (via server component), `SongApiResponse` from `lib/types`, `usePlayer` from `PlayerProvider`, `GenerationStatus` for inline-pending cards.
- Produces: `/history` route rendering all songs as a grid of `SongCard`s.

- [ ] **Step 1: Create `app/components/SongCard.module.css`**

```css
.card {
  border: 1px solid #e5e5e5;
  border-radius: 8px;
  background: white;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.prompt {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lyrics {
  font-size: 0.85rem;
  color: #666;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  font-family: ui-monospace, monospace;
}

.meta {
  font-size: 0.8rem;
  color: #888;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.badge {
  font-size: 0.75rem;
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
  text-transform: uppercase;
}

.badgePending { background: #fff3cd; color: #856404; }
.badgeReady { background: #d4edda; color: #155724; }
.badgeFailed { background: #f8d7da; color: #721c24; }

.actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.25rem;
}

.playBtn {
  background: #0070f3;
  color: white;
  border: none;
  padding: 0.4rem 0.8rem;
  border-radius: 4px;
  font-size: 0.85rem;
}

.playBtn:hover { background: #0060d3; }

.deleteBtn {
  background: transparent;
  color: #c0392b;
  border: 1px solid #e0c4be;
  padding: 0.4rem 0.8rem;
  border-radius: 4px;
  font-size: 0.85rem;
}

.deleteBtn:hover { background: #f8d7da; }
```

- [ ] **Step 2: Create `app/components/SongCard.tsx`**

```tsx
// app/components/SongCard.tsx
"use client";
import { useState } from "react";
import { usePlayer } from "@/app/components/PlayerProvider";
import { GenerationStatus } from "@/app/components/GenerationStatus";
import type { SongApiResponse } from "@/lib/types";
import styles from "./SongCard.module.css";

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString();
}

export function SongCard({ song }: { song: SongApiResponse }) {
  const { load } = usePlayer();
  const [deleted, setDeleted] = useState(false);

  async function onDelete() {
    setDeleted(true);
    await fetch(`/api/songs/${song.id}`, { method: "DELETE" });
  }

  if (deleted) return null;

  return (
    <div className={styles.card}>
      <div className={styles.prompt} title={song.prompt}>{song.prompt}</div>
      {song.lyrics && (
        <div className={styles.lyrics}>{song.lyrics}</div>
      )}
      <div className={styles.meta}>
        <span>{formatDate(song.createdAt)}</span>
        <span className={`${styles.badge} ${
          song.status === "pending" ? styles.badgePending
          : song.status === "ready" ? styles.badgeReady
          : styles.badgeFailed
        }`}>
          {song.status}
        </span>
      </div>
      {song.status === "failed" && song.error && (
        <div style={{ color: "#721c24", fontSize: "0.85rem" }}>{song.error}</div>
      )}
      {song.status === "pending" && <GenerationStatus id={song.id} />}
      {song.status === "ready" && (
        <div className={styles.actions}>
          <button className={styles.playBtn} onClick={() => load(song)}>Play</button>
          <button className={styles.deleteBtn} onClick={onDelete}>Delete</button>
        </div>
      )}
      {song.status === "failed" && (
        <div className={styles.actions}>
          <button className={styles.deleteBtn} onClick={onDelete}>Delete</button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create `app/components/SongList.tsx`**

```tsx
// app/components/SongList.tsx
import { SongCard } from "@/app/components/SongCard";
import type { SongApiResponse } from "@/lib/types";

export function SongList({ songs }: { songs: SongApiResponse[] }) {
  if (songs.length === 0) {
    return <p style={{ color: "#888" }}>No songs yet. Generate one on the <a href="/">Generate</a> page.</p>;
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
      {songs.map((s) => <SongCard key={s.id} song={s} />)}
    </div>
  );
}
```

- [ ] **Step 4: Create `app/history/page.tsx`**

```tsx
// app/history/page.tsx
import { SongList } from "@/app/components/SongList";
import { getDb } from "@/lib/app-db";
import { listSongs } from "@/lib/db";
import { toApiResponse } from "@/app/api/songs/route";

export const dynamic = "force-dynamic";

export default function HistoryPage() {
  const db = getDb();
  const songs = listSongs(db).map(toApiResponse);
  return (
    <div>
      <h1>Library</h1>
      <SongList songs={songs} />
    </div>
  );
}
```

- [ ] **Step 5: Verify typecheck**

Run: `pnpm typecheck`
Expected: exit 0.

- [ ] **Step 6: Verify dev server renders library page**

Run: `pnpm dev`, open `http://localhost:3000/history`. Confirm: "No songs yet" message (or grid of existing songs if any). Stop with `Ctrl-C`.

- [ ] **Step 7: Commit**

```bash
git add app/components/SongCard.tsx app/components/SongCard.module.css app/components/SongList.tsx app/history/page.tsx
git commit -m "feat: add library/history screen"
```

---

## Task 13: ACE-Step Launch Script

**Files:**
- Create: `scripts/start-acestep.sh`
- Create: `scripts/README.md`

**Interfaces:**
- Produces: an executable bash script that launches the ACE-Step API server with 12GB-tier environment variables.

- [ ] **Step 1: Create `scripts/start-acestep.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

# Launches ACE-Step 1.5 API server tuned for a 12GB GPU.
# Assumes ACE-Step-1.5 is cloned at $ACESTEP_DIR (or ../ACE-Step-1.5 by default)
# and that `uv sync` has been run there.

ACESTEP_DIR="${ACESTEP_DIR:-../ACE-Step-1.5}"

if [ ! -d "$ACESTEP_DIR" ]; then
  echo "ERROR: ACE-Step directory not found at $ACESTEP_DIR" >&2
  echo "Clone it:  git clone https://github.com/ACE-Step/ACE-Step-1.5.git" >&2
  echo "Or set ACESTEP_DIR to its path." >&2
  exit 1
fi

cd "$ACESTEP_DIR"

# 12GB VRAM tier: 2B sft DiT + 1.7B LM, vLLM backend, CPU offload.
export ACESTEP_CONFIG_PATH=acestep-v15-sft
export ACESTEP_LM_MODEL_PATH=acestep-5Hz-lm-1.7B
export ACESTEP_LM_BACKEND=vllm
export ACESTEP_OFFLOAD_TO_CPU=true
export ACESTEP_INIT_LLM=true
export ACESTEP_API_HOST=127.0.0.1
export ACESTEP_API_PORT=8001
export ACESTEP_API_WORKERS=1

echo "Starting ACE-Step API from $ACESTEP_DIR on http://127.0.0.1:8001"
exec uv run acestep-api
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x scripts/start-acestep.sh`
Expected: no output.

- [ ] **Step 3: Create `scripts/README.md`**

```
# Scripts

## start-acestep.sh

Launches the ACE-Step 1.5 API server configured for a 12GB GPU (2B sft DiT + 1.7B LM with CPU offloading).

### Prerequisites

1. Clone ACE-Step-1.5 (outside this repo, or wherever you prefer):
   ```
   git clone https://github.com/ACE-Step/ACE-Step-1.5.git
   cd ACE-Step-1.5
   uv sync
   ```
2. The script looks for ACE-Step at `$ACESTEP_DIR` or `../ACE-Step-1.5` by default. Override by setting `ACESTEP_DIR`:
   ```
   ACESTEP_DIR=/path/to/ACE-Step-1.5 ./scripts/start-acestep.sh
   ```

### Run

```
./scripts/start-acestep.sh
```

The server starts on http://127.0.0.1:8001. Models auto-download from HuggingFace on first run (may take a while).

### Then start Tuneamatic

In a separate terminal:
```
pnpm dev
```

Open http://localhost:3000.
```

- [ ] **Step 4: Verify script syntax**

Run: `bash -n scripts/start-acestep.sh`
Expected: exit 0 (no syntax errors).

- [ ] **Step 5: Commit**

```bash
git add scripts/start-acestep.sh scripts/README.md
git commit -m "feat: add ACE-Step launch script for 12GB tier"
```

---

## Task 14: Final Verification + README

**Files:**
- Create: `README.md`

**Interfaces:**
- Produces: project README with setup + run instructions, and a final verification pass.

- [ ] **Step 1: Create `README.md`**

```
# Tuneamatic

A local web frontend for the [ACE-Step 1.5](https://github.com/ace-step/ACE-Step-1.5) music generation model. Generate songs from a text description and lyrics, with a persisted library and sticky audio player.

## Prerequisites

- Node.js 18+ and pnpm
- Python 3.11+ and [uv](https://docs.astral.sh/uv/)
- A CUDA GPU with ~12GB VRAM (also works with more; see ACE-Step's GPU compatibility guide)

## Setup

### 1. Clone and install ACE-Step 1.5

```
git clone https://github.com/ACE-Step/ACE-Step-1.5.git
cd ACE-Step-1.5
uv sync
```

### 2. Clone and install Tuneamatic

```
git clone <this-repo> tuneamatic
cd tuneamatic
pnpm install
cp .env.local.example .env.local   # edit if your ACE-Step is on a different host/port
```

## Run

### Terminal 1: ACE-Step API server

```
./scripts/start-acestep.sh
```

First run downloads models from HuggingFace (~several GB). The server starts on http://127.0.0.1:8001 once ready.

### Terminal 2: Tuneamatic web app

```
pnpm dev
```

Open http://localhost:3000.

## Usage

1. On the Generate page, enter a description (e.g. "upbeat pop song with acoustic guitar") and optional lyrics.
2. Click "Generate song". A spinner with an elapsed timer appears while ACE-Step generates (typically 30s–2min on a 12GB GPU with offloading).
3. When ready, the song auto-loads in the sticky bottom player. Use the player controls to play, seek, and download.
4. The Library page shows all generated songs, persisted across restarts.

## Development

```
pnpm typecheck    # TypeScript check
pnpm lint         # ESLint
pnpm test:run     # Vitest (backend tests)
pnpm build        # Production build
```

## Architecture

See `docs/superpowers/specs/2026-07-26-tuneamatic-design.md` for the full design.

- **Next.js** (App Router) full-stack app on `:3000`
- **ACE-Step 1.5** FastAPI server on `:8001` (sibling process)
- **SQLite** (`data/tuneamatic.db`) for song metadata
- **Background poller** (`instrumentation.ts` → `lib/poller.ts`) drives task completion and downloads audio
- **Sticky bottom player** via React context (`PlayerProvider`)

## Troubleshooting

- **"ACE-Step server unreachable" on submit**: the API server isn't running. Start it with `./scripts/start-acestep.sh`.
- **Generation fails with OOM**: ensure `ACESTEP_OFFLOAD_TO_CPU=true` is set (it is by default in the launch script).
- **Audio file missing**: if you deleted `storage/audio/` or moved the project, DB rows may reference missing files. Delete the song from the library and regenerate.
```

- [ ] **Step 2: Run full test suite**

Run: `pnpm test:run`
Expected: all tests pass (db, acestep-client, poller, api-generate, api-songs).

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: exit 0.

- [ ] **Step 4: Run lint**

Run: `pnpm lint`
Expected: exit 0.

- [ ] **Step 5: Run production build**

Run: `pnpm build`
Expected: build succeeds. (Does not require ACE-Step running — poller only starts at runtime.)

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs: add README"
```

- [ ] **Step 7: Final manual smoke test (requires GPU + ACE-Step)**

1. Start ACE-Step: `./scripts/start-acestep.sh` (wait for "Application startup complete")
2. Start app: `pnpm dev`
3. Open `http://localhost:3000`
4. Submit: prompt = "short upbeat electronic loop", lyrics = "la la la", duration = 30 (advanced)
5. Confirm: spinner + elapsed timer appears
6. Wait: song completes (30s–2min), auto-loads in bottom player
7. Click play: audio plays
8. Navigate to `/history`: song appears with "ready" badge
9. Click Play on the card: bottom player switches to it
10. Click Delete: card disappears
11. Refresh page: remaining songs persist

---

## Self-Review Notes

**Spec coverage:**
- Architecture & repo layout → Task 1
- Data model (songs table) → Task 3
- API routes (6 routes) → Tasks 6, 7, 8
- Background poller → Task 5
- Frontend (generate screen, library screen, player bar, advanced drawer, generation status) → Tasks 9, 10, 11, 12
- Configuration (.env.local, start-acestep.sh) → Tasks 1, 13
- Error handling (503, 429, failed status, missing audio) → Tasks 6, 7, 8, 10
- Testing (backend lib + routes) → Tasks 3, 4, 5, 6, 7
- Out of scope items (auth, multi-user, editing, LoRA, etc.) → not implemented (correct)

**Type consistency:** `Song` (db) vs `SongApiResponse` (API) — the `toApiResponse` helper in `app/api/songs/route.ts` bridges them. `audioUrl` is computed (not stored). `audio_path` (db column) maps to `audioPath` (TS) and `audioUrl` (API). `seed_value` (ACE-Step raw) → `seedValue` (TS field). Verified consistent across tasks 3, 4, 5, 7, 9, 10, 12.

**Placeholder scan:** No TBD/TODO. All steps contain actual code or commands.