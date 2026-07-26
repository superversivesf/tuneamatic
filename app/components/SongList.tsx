import { SongCard } from "@/app/components/SongCard";
import type { SongApiResponse } from "@/lib/types";

export function SongList({ songs }: { songs: SongApiResponse[] }) {
  if (songs.length === 0) {
    return <p style={{ color: "#888" }}>No songs yet. Generate one on the <a href="/">Generate</a> page.</p>;
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
      {songs.map((s) => <SongCard key={s.id} song={s} />)}
    </div>
  );
}