#!/usr/bin/env bash
set -euo pipefail

# Launches ACE-Step 1.5 API server tuned for a 12GB NVIDIA GPU (Tier 5).
# Uses 2B sft DiT + 1.7B LM, vLLM backend, CPU offload.
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

# 12GB VRAM tier (Tier 5): turbo DiT + 1.7B LM, vLLM backend, CPU offload.
# Turbo model is optimized for 8 inference steps — fast and good quality.
export ACESTEP_CONFIG_PATH=acestep-v15-turbo
export ACESTEP_LM_MODEL_PATH=acestep-5Hz-lm-1.7B
export ACESTEP_LM_BACKEND=vllm
export ACESTEP_OFFLOAD_TO_CPU=true
export ACESTEP_INIT_LLM=true
export ACESTEP_API_HOST=127.0.0.1
export ACESTEP_API_PORT=8001
export ACESTEP_API_WORKERS=1

echo "Starting ACE-Step API from $ACESTEP_DIR on http://127.0.0.1:8001"
echo "  DiT: acestep-v15-turbo (turbo, CPU offload)"
echo "  LM:  acestep-5Hz-lm-1.7B (vLLM)"
exec uv run acestep-api