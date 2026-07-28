"use client";
import { useState, FormEvent } from "react";
import { AdvancedDrawer, AdvancedValues } from "@/app/components/AdvancedDrawer";
import { GenerationStatus } from "@/app/components/GenerationStatus";
import styles from "./GenerateForm.module.css";

export function GenerateForm() {
  const [title, setTitle] = useState("");
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
        body: JSON.stringify({ title, prompt, lyrics, advanced }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      const data = await res.json();
      setSongId(data.id);
    } catch (err: any) {
      setError(err.message ?? "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  function handleComplete() {
    setTitle("");
    setPrompt("");
    setLyrics("");
    setAdvanced({});
    setSongId(null);
  }

  return (
    <div>
      <form className={styles.form} onSubmit={onSubmit}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="title">Song title (optional)</label>
          <input
            id="title"
            className={styles.input}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Alien Abduction Love Song"
          />
        </div>
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
          disabled={submitting || !prompt.trim() || !!songId}
        >
          {submitting ? "Submitting…" : songId ? "Generating…" : "Generate song"}
        </button>
      </form>
      {songId && <GenerationStatus id={songId} onComplete={handleComplete} />}
    </div>
  );
}