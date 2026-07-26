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