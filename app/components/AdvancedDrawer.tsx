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
              Thinking mode (LM plans the song — higher quality, but may override your BPM/key)
            </label>
          </div>
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
          <div className={styles.advancedField}>
            <label>Inference steps (turbo: 8, base: 32–64)</label>
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
            <label>Guidance scale (base model only)</label>
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