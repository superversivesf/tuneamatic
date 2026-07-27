import { NextResponse } from "next/server";
import { getDb } from "@/lib/app-db";
import { getSong } from "@/lib/db";
import { createReadStream, statSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  const db = getDb();
  const song = getSong(db, params.id);
  console.log(`[audio] id=${params.id} song=${song ? `found status=${song.status} audioPath=${song.audioPath}` : 'not found'}`);
  if (!song || song.status !== "ready" || !song.audioPath) {
    return NextResponse.json({ error: "audio not available" }, { status: 404 });
  }
  const absPath = join(process.cwd(), "storage", song.audioPath);
  console.log(`[audio] looking for file at ${absPath}`);
  let size: number;
  try {
    size = statSync(absPath).size;
  } catch {
    return NextResponse.json({ error: "audio file missing" }, { status: 404 });
  }

  const range = req.headers.get("range");
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      const start = m[1] ? parseInt(m[1], 10) : 0;
      const end = m[2] ? parseInt(m[2], 10) : size - 1;
      const chunkSize = end - start + 1;
      const stream = createReadStream(absPath, { start, end });
      return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
        status: 206,
        headers: {
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(chunkSize),
          "Content-Type": "audio/mpeg",
        },
      });
    }
  }

  const stream = createReadStream(absPath);
  return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers: {
      "Accept-Ranges": "bytes",
      "Content-Length": String(size),
      "Content-Type": "audio/mpeg",
    },
  });
}