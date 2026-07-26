import { NextResponse } from "next/server";
import { getDb } from "@/lib/app-db";
import { listSongs } from "@/lib/db";
import { toApiResponse } from "@/lib/api-response";
import type { SongApiResponse } from "@/lib/types";

export async function GET(): Promise<Response> {
  const db = getDb();
  const songs = listSongs(db);
  const payload: SongApiResponse[] = songs.map(toApiResponse);
  return NextResponse.json(payload);
}