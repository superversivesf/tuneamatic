"use client";
import { usePlayer } from "@/app/components/PlayerProvider";
import styles from "./PlayerBar.module.css";

export function PlayerBar() {
  const { song, audioRef } = usePlayer();
  const displayName = song?.title || song?.prompt || "Unknown";
  const downloadName = song?.title
    ? `${song.title.replace(/[^a-zA-Z0-9_-]/g, "_")}.mp3`
    : `${song?.id ?? "song"}.mp3`;
  return (
    <div className={styles.bar}>
      <div className={styles.title}>
        {song ? (
          <span title={song.prompt}>{displayName}</span>
        ) : (
          <span className={styles.empty}>No song loaded</span>
        )}
      </div>
      {song && song.audioUrl ? (
        <>
          <audio
            ref={audioRef}
            src={song.audioUrl}
            controls
            className={styles.audio}
            data-testid="player-audio"
          />
          <a
            className={styles.download}
            href={song.audioUrl}
            download={downloadName}
          >
            Download
          </a>
        </>
      ) : null}
    </div>
  );
}