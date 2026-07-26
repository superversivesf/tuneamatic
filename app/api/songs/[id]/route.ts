import { NextResponse } from "next/server";
import { getDb } from "@/lib/app-db";
import { getSong, deleteSong } from "@/lib/db";
import { unlinkSync } from "node:fs";
import { join } from "node:path";
import { toApiResponse } from "@/app/api/songs/route";

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  const db = getDb();
  const song = getSong(db, params.id);
  if (!song) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(toApiResponse(song));
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  const db = getDb();
  const song = getSong(db, params.id);
  if (!song) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (song.audioPath) {
    try {
      unlinkSync(join(process.cwd(), "storage", song.audioPath));
    } catch {
      /* best-effort */
    }
  }
  deleteSong(db, params.id);
  return new NextResponse(null, { status: 204 });
}