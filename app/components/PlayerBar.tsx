"use client";
import { usePlayer } from "@/app/components/PlayerProvider";
import styles from "./PlayerBar.module.css";

export function PlayerBar() {
  const { song, audioRef } = usePlayer();
  return (
    <div className={styles.bar}>
      <div className={styles.title}>
        {song ? (
          <span title={song.prompt}>{song.prompt}</span>
        ) : (
          <span className={styles.empty}>No song loaded</span>
        )}
      </div>
      {song && song.audioUrl ? (
        <>
          <audio
            ref={audioRef}
            controls
            className={styles.audio}
            data-testid="player-audio"
          />
          <a
            className={styles.download}
            href={song.audioUrl}
            download={`${song.id}.mp3`}
          >
            Download
          </a>
        </>
      ) : null}
    </div>
  );
}