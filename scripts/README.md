# Scripts

## start-acestep.sh

Launches the ACE-Step 1.5 API server for a **16GB NVIDIA GPU** (Tier 6a).
Uses the XL (4B) sft DiT for higher audio quality with CPU offload + 1.7B LM via vLLM.

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

### Run (desktop, 16GB NVIDIA)

```
./scripts/start-acestep.sh
```

The server starts on http://127.0.0.1:8001. Models auto-download from HuggingFace on first run (may take a while).

### Then start Tuneamatic

In a separate terminal:
```
pnpm dev
```

Open http://localhost:5432.

---

## start-acestep-mac.sh

Launches the ACE-Step 1.5 API server for **Apple Silicon** (M1/M2/M3/M4).
Uses the MLX backend with 2B sft DiT + 0.6B LM — conservative settings for 16GB shared memory.

### Prerequisites

1. Clone ACE-Step-1.5 (outside this repo, or wherever you prefer):
   ```
   git clone https://github.com/ACE-Step/ACE-Step-1.5.git
   cd ACE-Step-1.5
   uv sync
   ```
2. The script looks for ACE-Step at `$ACESTEP_DIR` or `../ACE-Step-1.5` by default. Override by setting `ACESTEP_DIR`:
   ```
   ACESTEP_DIR=/path/to/ACE-Step-1.5 ./scripts/start-acestep-mac.sh
   ```

### Run (Mac, Apple Silicon)

```
chmod +x scripts/start-acestep-mac.sh   # first time only
./scripts/start-acestep-mac.sh
```

The server starts on http://127.0.0.1:8001. Models auto-download from HuggingFace on first run.

### Then start Tuneamatic

In a separate terminal:
```
pnpm dev
```

Open http://localhost:5432.