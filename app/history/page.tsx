import { SongList } from "@/app/components/SongList";
import { getDb } from "@/lib/app-db";
import { listSongs } from "@/lib/db";
import { toApiResponse } from "@/lib/api-response";

export const dynamic = "force-dynamic";

export default function HistoryPage() {
  const db = getDb();
  const songs = listSongs(db).map(toApiResponse);
  return (
    <div>
      <h1>Library</h1>
      <SongList songs={songs} />
    </div>
  );
}