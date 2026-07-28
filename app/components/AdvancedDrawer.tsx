"use client";
import { useState } from "react";
import styles from "./GenerateForm.module.css";

export interface AdvancedValues {
  duration?: number;
  bpm?: number;
  keyScale?: string;
  timeSignature?: string;
  seed?: number;
  batchSize?: number;
  thinking?: boolean;
  inferenceSteps?: number;
  guidanceScale?: number;
  cotCaption?: boolean;
}

function Tip({ text }: { text: string }) {
  return (
    <span
      style={{
        marginLeft: "0.3rem",
        color: "#999",
        cursor: "help",
        fontSize: "0.8rem",
      }}
      title={text}
    >
      ?
    </span>
  );
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
          <div className={styles.advancedField} style={{ gridColumn: "1 / -1" }}>
            <label>
              <input
                type="checkbox"
                checked={values.thinking ?? true}
                onChange={(e) => set("thinking", e.target.checked)}
                style={{ marginRight: "0.5rem" }}
              />
              Thinking mode
              <Tip text="When ON, the LM (language model) plans the song structure before generating audio — higher quality, but it may rewrite your prompt, BPM, and key. When OFF, the DiT generates directly from your description — more literal but lower quality." />
            </label>
          </div>
          <div className={styles.advancedField} style={{ gridColumn: "1 / -1" }}>
            <label>
              <input
                type="checkbox"
                checked={values.cotCaption ?? true}
                onChange={(e) => set("cotCaption", e.target.checked)}
                style={{ marginRight: "0.5rem" }}
              />
              Allow LM to rewrite description (CoT)
              <Tip text="When ON (default), the LM uses Chain-of-Thought to expand and rewrite your description. This is why your BPM/key/style may be overridden. Turn OFF to force ACE-Step to use your description literally. Only works when Thinking mode is ON." />
            </label>
            <div style={{ marginLeft: "1.5rem", fontSize: "0.8rem", color: "#666", marginTop: "0.25rem" }}>
              BPM, key, and time signature set in the fields below are always preserved — even when CoT is ON. The LM only rewrites the description text, not these parameters. Put your tempo/key here, not in the description.
            </div>
          </div>
          <div className={styles.advancedField}>
            <label>
              Duration (s, 10–600)
              <Tip text="Length of the generated song in seconds. Longer songs take proportionally more time." />
            </label>
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
            <label>
              BPM (30–300)
              <Tip text="Beats per minute — the tempo. 60 = slow ballad, 120 = pop standard, 180 = fast punk. Note: when Thinking mode + CoT rewrite are ON, the LM may override this." />
            </label>
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
            <label>
              Key / scale
              <Tip text="Musical key, e.g. 'C Major', 'Am', 'F# minor'. Note: may be overridden by LM when CoT rewrite is ON." />
            </label>
            <input
              type="text"
              placeholder="e.g. C Major, Am"
              value={values.keyScale ?? ""}
              onChange={(e) => set("keyScale", e.target.value || undefined)}
            />
          </div>
          <div className={styles.advancedField}>
            <label>
              Time signature
              <Tip text="Musical time signature: 2/4, 3/4, 4/4 (default), or 6/8. Note: may be overridden by LM when CoT rewrite is ON." />
            </label>
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
            <label>
              Seed (blank = random)
              <Tip text="Same seed + same params = same song. Use this to reproduce a song you liked. Leave blank for a new random song each time." />
            </label>
            <input
              type="number"
              value={values.seed ?? ""}
              onChange={(e) =>
                set("seed", e.target.value ? Number(e.target.value) : undefined)
              }
            />
          </div>
          <div className={styles.advancedField}>
            <label>
              Batch size (1–8)
              <Tip text="How many songs to generate at once. More = more variations but proportionally slower and more memory." />
            </label>
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
          <div className={styles.advancedField}>
            <label>
              Inference steps
              <Tip text="Diffusion steps. Turbo model: 8 is optimal (1–20 range). Base/sft model: 32–64 is the sweet spot (1–200 range). More steps = higher quality but slower. Too many steps (100+) can cause over-refinement artifacts — diminishing returns and degradation." />
            </label>
            <input
              type="number"
              min={1}
              max={200}
              value={values.inferenceSteps ?? ""}
              onChange={(e) =>
                set("inferenceSteps", e.target.value ? Number(e.target.value) : undefined)
              }
            />
          </div>
          <div className={styles.advancedField}>
            <label>
              Guidance scale (base model only)
              <Tip text="How closely to follow your prompt. Higher = more literal/accurate to description. Lower = more creative/loose. 7.0 is default. Only effective with the base/sft model, not turbo. Try 10–15 for strict prompt adherence." />
            </label>
            <input
              type="number"
              step={0.5}
              min={1}
              max={20}
              value={values.guidanceScale ?? ""}
              onChange={(e) =>
                set("guidanceScale", e.target.value ? Number(e.target.value) : undefined)
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}