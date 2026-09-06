# Tuneamatic

A local web frontend for the [ACE-Step 1.5](https://github.com/ace-step/ACE-Step-1.5) music generation model. Generate songs from a text description and lyrics, with a persisted library and sticky audio player.

## Prerequisites

- Node.js 20.9+ and pnpm
- Python 3.11+ and [uv](https://docs.astral.sh/uv/)
- A GPU with at least 12GB VRAM:
  - **NVIDIA** (16GB): uses XL (4B) DiT + 1.7B LM with CPU offload — best quality
  - **Apple Silicon** (M1-M4, 16GB shared): uses 2B DiT + 0.6B LM with MLX backend

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
cp .env.local.example .env.local
```

> If you switch Node.js major versions, run `pnpm rebuild better-sqlite3`.

Edit `.env.local` if your ACE-Step server is on a different host/port.

## Run

### Terminal 1: ACE-Step API server

**12GB NVIDIA GPU:**
```
./scripts/start-acestep-12gb.sh
```

**16GB NVIDIA GPU (XL quality):**
```
./scripts/start-acestep-16gb.sh
```

**Apple Silicon Mac (M1-M4, 16GB shared):**
```
./scripts/start-acestep-mac.sh
```

First run downloads models from HuggingFace (~several GB). The server starts on http://127.0.0.1:8001 once ready.

### Terminal 2: Tuneamatic web app

```
pnpm dev
```

Open http://localhost:5433.

## Usage

1. On the Generate page, enter a description (e.g. "upbeat pop song with acoustic guitar") and optional lyrics.
2. Click "Generate song". A spinner with an elapsed timer appears while ACE-Step generates (typically 30s-2min on a 12GB GPU with offloading).
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

- **Next.js** (App Router) full-stack app on `:5433`
- **ACE-Step 1.5** FastAPI server on `:8001` (sibling process)
- **SQLite** (`data/tuneamatic.db`) for song metadata
- **Background poller** (`instrumentation.ts` -> `lib/poller.ts`) drives task completion and downloads audio
- **Sticky bottom player** via React context (`PlayerProvider`)

## Troubleshooting

- **"ACE-Step server unreachable" on submit**: the API server isn't running. Start it with one of the scripts in `scripts/` (12gb NVIDIA, 16gb NVIDIA, or Mac).
- **Generation fails with OOM**: ensure `ACESTEP_OFFLOAD_TO_CPU=true` is set (it is by default in the launch script).
- **Audio file missing**: if you deleted `storage/audio/` or moved the project, DB rows may reference missing files. Delete the song from the library and regenerate.