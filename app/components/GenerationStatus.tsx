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

export function GenerationStatus({ id, onComplete }: { id: string; onComplete?: () => void }) {
  const { load } = usePlayer();
  const [song, setSong] = useState<SongApiResponse | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [done, setDone] = useState(false);
  const createdAtRef = useRef<number | null>(null);

  useEffect(() => {
    let stop = false;
    let loaded = false;
    async function tick() {
      const res = await fetch(`/api/songs/${id}`);
      if (!res.ok) return;
      const s: SongApiResponse = await res.json();
      if (stop) return;
      setSong(s);
      if (s.status === "ready") {
        if (!loaded) {
          loaded = true;
          load(s);
        }
        setDone(true);
        onComplete?.();
        return;
      }
      if (s.status === "failed") {
        setDone(true);
        onComplete?.();
        return;
      }
      setTimeout(tick, 2000);
    }
    tick();
    return () => { stop = true; };
  }, [id, load, onComplete]);

  useEffect(() => {
    if (!song) return;
    if (createdAtRef.current === null) createdAtRef.current = song.createdAt;
    if (song.status !== "pending") return;
    const t = setInterval(() => {
      setElapsed(Date.now() - (createdAtRef.current ?? Date.now()));
    }, 1000);
    return () => clearInterval(t);
  }, [song]);

  if (!song) return null;

  const expandedPrompt = song.metas?.prompt;
  const metas = song.metas;

  return (
    <div>
      {song.status === "pending" && (
        <div className={styles.status}>
          <span className={styles.spinner} aria-label="generating" />
          <span>Generating…</span>
          <span className={styles.timer}>{formatElapsed(elapsed)}</span>
        </div>
      )}
      {song.status === "failed" && (
        <div className={`${styles.status} ${styles.error}`}>
          <span>Generation failed: {song.error ?? "unknown error"}</span>
        </div>
      )}
      {song.status === "ready" && (
        <div className={styles.status}>
          <span>Done! Ready to play.</span>
        </div>
      )}
      {expandedPrompt && (
        <div style={{ marginTop: "0.75rem", padding: "0.75rem", background: "#f0f0f0", borderRadius: "6px", fontSize: "0.85rem" }}>
          <strong>Expanded prompt (what ACE-Step actually used):</strong>
          <pre style={{ whiteSpace: "pre-wrap", marginTop: "0.5rem", fontFamily: "inherit" }}>{expandedPrompt}</pre>
        </div>
      )}
      {metas && song.status === "ready" && (
        <div style={{ marginTop: "0.5rem", fontSize: "0.85rem", color: "#666" }}>
          BPM: {metas.bpm ?? "?"} | Key: {metas.keyscale ?? "?"} | Duration: {metas.duration ?? "?"}s | Time sig: {metas.timesignature ?? "?"}
        </div>
      )}
    </div>
  );
}