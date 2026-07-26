"use client";
import { createContext, useContext, useRef, useState, ReactNode } from "react";
import type { SongApiResponse } from "@/lib/types";

interface PlayerContextValue {
  song: SongApiResponse | null;
  audioRef: React.RefObject<HTMLAudioElement>;
  load: (song: SongApiResponse) => void;
  clear: () => void;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [song, setSong] = useState<SongApiResponse | null>(null);

  function load(s: SongApiResponse) {
    setSong(s);
    if (audioRef.current && s.audioUrl) {
      audioRef.current.src = s.audioUrl;
      audioRef.current.play().catch(() => {
        /* autoplay blocked — user can press play */
      });
    }
  }

  function clear() {
    setSong(null);
    if (audioRef.current) audioRef.current.src = "";
  }

  return (
    <PlayerContext.Provider value={{ song, audioRef, load, clear }}>
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used within PlayerProvider");
  return ctx;
}