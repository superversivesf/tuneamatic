"use client";
import { useState } from "react";
import { usePlayer } from "@/app/components/PlayerProvider";
import { GenerationStatus } from "@/app/components/GenerationStatus";
import type { SongApiResponse } from "@/lib/types";
import styles from "./SongCard.module.css";

function formatDate(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19);
}

export function SongCard({ song }: { song: SongApiResponse }) {
  const { load } = usePlayer();
  const [deleted, setDeleted] = useState(false);

  async function onDelete() {
    setDeleted(true);
    await fetch(`/api/songs/${song.id}`, { method: "DELETE" });
  }

  if (deleted) return null;

  return (
    <div className={styles.card}>
      <div className={styles.prompt} title={song.prompt}>{song.prompt}</div>
      {song.lyrics && (
        <div className={styles.lyrics}>{song.lyrics}</div>
      )}
      <div className={styles.meta}>
        <span>{formatDate(song.createdAt)}</span>
        <span className={`${styles.badge} ${
          song.status === "pending" ? styles.badgePending
          : song.status === "ready" ? styles.badgeReady
          : styles.badgeFailed
        }`}>
          {song.status}
        </span>
      </div>
      {song.status === "failed" && song.error && (
        <div style={{ color: "#721c24", fontSize: "0.85rem" }}>{song.error}</div>
      )}
      {song.status === "pending" && <GenerationStatus id={song.id} />}
      {song.status === "ready" && (
        <div className={styles.actions}>
          <button className={styles.playBtn} onClick={() => load(song)}>Play</button>
          <button className={styles.deleteBtn} onClick={onDelete}>Delete</button>
        </div>
      )}
      {song.status === "failed" && (
        <div className={styles.actions}>
          <button className={styles.deleteBtn} onClick={onDelete}>Delete</button>
        </div>
      )}
    </div>
  );
}