#!/usr/bin/env bash
set -euo pipefail

# Launches ACE-Step 1.5 API server for Apple Silicon (M1/M2/M3/M4).
# Uses MLX backend for native Apple Silicon acceleration.
# 16GB shared memory: 2B sft DiT + 0.6B LM, conservative settings.
#
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

# Apple Silicon 16GB shared memory: 2B sft DiT + 0.6B LM, MLX backend.
# 16GB is shared between CPU and GPU — use the smaller 0.6B LM to leave
# room for the OS and the DiT model.
export ACESTEP_CONFIG_PATH=acestep-v15-sft
export ACESTEP_LM_MODEL_PATH=acestep-5Hz-lm-0.6B
export ACESTEP_LM_BACKEND=mlx
export ACESTEP_OFFLOAD_TO_CPU=true
export ACESTEP_INIT_LLM=true
export ACESTEP_API_HOST=127.0.0.1
export ACESTEP_API_PORT=8001
export ACESTEP_API_WORKERS=1

echo "Starting ACE-Step API from $ACESTEP_DIR on http://127.0.0.1:8001"
echo "  DiT: acestep-v15-sft (2B, MLX)"
echo "  LM:  acestep-5Hz-lm-0.6B (MLX)"
exec uv run acestep-api