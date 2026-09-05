import { NextResponse } from "next/server";
import { getDb } from "@/lib/app-db";
import { getSong } from "@/lib/db";
import { createReadStream, statSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { getStorageDir } from "@/lib/storage";

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  const db = getDb();
  const song = getSong(db, params.id);
  if (!song || song.status !== "ready" || !song.audioPath) {
    return NextResponse.json({ error: "audio not available" }, { status: 404 });
  }
  const absPath = join(getStorageDir(), song.audioPath);
  let size: number;
  try {
    size = statSync(absPath).size;
  } catch {
    return NextResponse.json({ error: "audio file missing" }, { status: 404 });
  }
  if (size === 0) {
    return NextResponse.json({ error: "audio file missing" }, { status: 404 });
  }

  const downloadName = (song.title || song.prompt || song.id)
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 60) + ".mp3";

  const range = req.headers.get("range");
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    let start = 0, end = 0;
    let satisfiable = true;
    if (!m) {
      satisfiable = false; // malformed → fall through to full 200
    } else {
      const [, s, e] = m;
      if (s === "" && e === "") {
        satisfiable = false;
      } else if (s === "") {
        // suffix range: last N bytes
        const n = parseInt(e, 10);
        if (n === 0) return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
        start = Math.max(0, size - n);
        end = size - 1;
      } else {
        start = parseInt(s, 10);
        if (start >= size) {
          return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
        }
        end = e === "" ? size - 1 : Math.min(parseInt(e, 10), size - 1);
      }
      if (satisfiable && end < start) end = size - 1;
    }
    if (m && satisfiable) {
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
      "Content-Disposition": `attachment; filename="${downloadName}"`,
    },
  });
}