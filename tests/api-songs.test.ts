import { mkdtempSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.TUNEAMATIC_DB = join(mkdtempSync(join(tmpdir(), "tuneamatic-test-")), "test.db");
process.env.TUNEAMATIC_STORAGE_DIR = "/tmp/tuneamatic-test-storage";

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { GET as listSongs } from "@/app/api/songs/route";
import { GET as getSong, DELETE as deleteSong } from "@/app/api/songs/[id]/route";
import { GET as GET_AUDIO } from "@/app/api/audio/[id]/route";
import { insertSong, markReady } from "@/lib/db";
import { getDb } from "@/lib/app-db";

beforeEach(() => {
  getDb().exec("DELETE FROM songs");
});

describe("GET /api/songs", () => {
  it("returns songs newest-first as SongApiResponse", async () => {
    const db = getDb();
    const id1 = insertSong(db, { taskId: "t1", title: "", prompt: "first", lyrics: "a", advanced: {} });
    const id2 = insertSong(db, { taskId: "t2", title: "", prompt: "second", lyrics: "b", advanced: {} });
    const res = await listSongs();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(body[0].id).toBe(id2);
    expect(body[0].audioUrl).toBeNull();
    expect(body[1].id).toBe(id1);
  });
});

describe("GET /api/songs/[id]", () => {
  it("returns the song with audioUrl when ready", async () => {
    const db = getDb();
    const id = insertSong(db, { taskId: "t1", title: "", prompt: "p", lyrics: "", advanced: {} });
    markReady(db, id, {
      audioPath: `audio/${id}.mp3`,
      metas: { bpm: 120 },
      seedValue: "1",
      ditModel: "acestep-v15-sft",
      lmModel: "acestep-5Hz-lm-1.7B",
    });
    const req = new Request(`http://localhost:5433/api/songs/${id}`);
    const res = await getSong(req, { params: { id } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ready");
    expect(body.audioUrl).toBe(`/api/audio/${id}`);
  });

  it("returns 404 for missing song", async () => {
    const req = new Request("http://localhost:5433/api/songs/nope");
    const res = await getSong(req, { params: { id: "nope" } });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/songs/[id]", () => {
  it("returns 204 and deletes the row", async () => {
    const db = getDb();
    const id = insertSong(db, { taskId: "t1", title: "", prompt: "p", lyrics: "", advanced: {} });
    const req = new Request(`http://localhost:5433/api/songs/${id}`, { method: "DELETE" });
    const res = await deleteSong(req, { params: { id } });
    expect(res.status).toBe(204);
    const list = await listSongs();
    expect((await list.json())).toHaveLength(0);
  });

  it("returns 404 for missing song", async () => {
    const req = new Request("http://localhost:5433/api/songs/nope", { method: "DELETE" });
    const res = await deleteSong(req, { params: { id: "nope" } });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/songs/[id] origin guard", () => {
  it("rejects cross-origin DELETE with 403", async () => {
    const req = new Request("http://localhost:5433/api/songs/xyz", {
      method: "DELETE",
      headers: { Origin: "http://evil.example", Host: "localhost:5433" },
    });
    const res = await deleteSong(req, { params: { id: "xyz" } });
    expect(res.status).toBe(403);
  });

  it("allows DELETE without Origin header", async () => {
    const req = new Request("http://localhost:5433/api/songs/xyz", {
      method: "DELETE",
    });
    const res = await deleteSong(req, { params: { id: "xyz" } });
    expect(res.status).not.toBe(403); // 404 — id doesn't exist
  });
});

describe("GET /api/audio/[id] range parsing", () => {
  const storageDir = process.env.TUNEAMATIC_STORAGE_DIR!;
  const testId = "rangeTestSong1";

  beforeAll(() => {
    mkdirSync(`${storageDir}/audio`, { recursive: true });
    writeFileSync(`${storageDir}/audio/${testId}.mp3`, Buffer.alloc(1000, 1));
  });

  beforeEach(() => {
    getDb().prepare(
      `INSERT OR REPLACE INTO songs (id, task_id, status, title, prompt, lyrics, advanced, created_at, audio_path)
       VALUES (?, 't', 'ready', '', 'p', '', '{}', ?, 'audio/${testId}.mp3')`
    ).run(testId, Date.now());
  });

  afterAll(() => {
    getDb().prepare("DELETE FROM songs WHERE id = ?").run(testId);
    try { unlinkSync(`${storageDir}/audio/${testId}.mp3`); } catch {}
  });

  it("serves suffix range bytes=-100 as the last 100 bytes", async () => {
    const res = await GET_AUDIO(
      new Request("http://localhost:5433/api/audio/" + testId, {
        headers: { Range: "bytes=-100" },
      }),
      { params: { id: testId } }
    );
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 900-999/1000");
    expect(res.headers.get("Content-Length")).toBe("100");
  });

  it("clamps an oversized end to the file size", async () => {
    const res = await GET_AUDIO(
      new Request("http://localhost:5433/api/audio/" + testId, {
        headers: { Range: "bytes=0-99999" },
      }),
      { params: { id: testId } }
    );
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 0-999/1000");
    expect(res.headers.get("Content-Length")).toBe("1000");
  });

  it("returns 416 for a start beyond the file size", async () => {
    const res = await GET_AUDIO(
      new Request("http://localhost:5433/api/audio/" + testId, {
        headers: { Range: "bytes=5000-6000" },
      }),
      { params: { id: testId } }
    );
    expect(res.status).toBe(416);
    expect(res.headers.get("Content-Range")).toBe("bytes */1000");
  });

  it("falls back to full 200 on a malformed Range header", async () => {
    const res = await GET_AUDIO(
      new Request("http://localhost:5433/api/audio/" + testId, {
        headers: { Range: "bytes=abc" },
      }),
      { params: { id: testId } }
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Length")).toBe("1000");
  });
});