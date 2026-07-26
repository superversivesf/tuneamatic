import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET as listSongs } from "@/app/api/songs/route";
import { GET as getSong, DELETE as deleteSong } from "@/app/api/songs/[id]/route";
import { insertSong, markReady } from "@/lib/db";
import { getDb } from "@/lib/app-db";

beforeEach(() => {
  getDb().exec("DELETE FROM songs");
});

describe("GET /api/songs", () => {
  it("returns songs newest-first as SongApiResponse", async () => {
    const db = getDb();
    const id1 = insertSong(db, { taskId: "t1", prompt: "first", lyrics: "a", advanced: {} });
    const id2 = insertSong(db, { taskId: "t2", prompt: "second", lyrics: "b", advanced: {} });
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
    const id = insertSong(db, { taskId: "t1", prompt: "p", lyrics: "", advanced: {} });
    markReady(db, id, {
      audioPath: `audio/${id}.mp3`,
      metas: { bpm: 120 },
      seedValue: "1",
      ditModel: "acestep-v15-sft",
      lmModel: "acestep-5Hz-lm-1.7B",
    });
    const req = new Request(`http://localhost:3000/api/songs/${id}`);
    const res = await getSong(req, { params: { id } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ready");
    expect(body.audioUrl).toBe(`/api/audio/${id}`);
  });

  it("returns 404 for missing song", async () => {
    const req = new Request("http://localhost:3000/api/songs/nope");
    const res = await getSong(req, { params: { id: "nope" } });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/songs/[id]", () => {
  it("returns 204 and deletes the row", async () => {
    const db = getDb();
    const id = insertSong(db, { taskId: "t1", prompt: "p", lyrics: "", advanced: {} });
    const req = new Request(`http://localhost:3000/api/songs/${id}`, { method: "DELETE" });
    const res = await deleteSong(req, { params: { id } });
    expect(res.status).toBe(204);
    const list = await listSongs();
    expect((await list.json())).toHaveLength(0);
  });

  it("returns 404 for missing song", async () => {
    const req = new Request("http://localhost:3000/api/songs/nope", { method: "DELETE" });
    const res = await deleteSong(req, { params: { id: "nope" } });
    expect(res.status).toBe(404);
  });
});