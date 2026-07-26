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

Open http://localhost:5432.