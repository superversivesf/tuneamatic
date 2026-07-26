import { NextResponse } from "next/server";
import { getDb } from "@/lib/app-db";
import { listSongs } from "@/lib/db";
import type { Song, SongApiResponse } from "@/lib/types";

export function toApiResponse(s: Song): SongApiResponse {
  return {
    id: s.id,
    status: s.status,
    prompt: s.prompt,
    lyrics: s.lyrics,
    advanced: s.advanced,
    createdAt: s.createdAt,
    readyAt: s.readyAt,
    error: s.error,
    audioUrl: s.status === "ready" && s.audioPath ? `/api/audio/${s.id}` : null,
    metas: s.metas,
    seedValue: s.seedValue,
    ditModel: s.ditModel,
    lmModel: s.lmModel,
  };
}

export async function GET(): Promise<Response> {
  const db = getDb();
  const songs = listSongs(db);
  const payload: SongApiResponse[] = songs.map(toApiResponse);
  return NextResponse.json(payload);
}