import { describe, it, expect } from "vitest";
import { makeTestDb } from "@/lib/test-helpers";
import { insertSong, getSong, markReady, markFailed, listSongs, listPendingSongs, deleteSong } from "@/lib/db";

describe("db", () => {
  it("inserts and retrieves a pending song", () => {
    const db = makeTestDb();
    const id = insertSong(db, {
      taskId: "ace-task-123",
      title: "",
      prompt: "upbeat pop song",
      lyrics: "hello world",
      advanced: { bpm: 120 },
    });
    expect(id).toMatch(/^[A-Za-z0-9_-]{10,}$/);

    const song = getSong(db, id);
    expect(song).not.toBeNull();
    expect(song!.status).toBe("pending");
    expect(song!.prompt).toBe("upbeat pop song");
    expect(song!.lyrics).toBe("hello world");
    expect(song!.advanced).toEqual({ bpm: 120 });
    expect(song!.audioPath).toBeNull();
    expect(song!.readyAt).toBeNull();
    expect(song!.createdAt).toBeGreaterThan(0);
  });
});

describe("markReady", () => {
  it("sets status=ready and populates result fields", () => {
    const db = makeTestDb();
    const id = insertSong(db, {
      taskId: "t1",
      title: "",
      prompt: "p",
      lyrics: "",
      advanced: {},
    });
    markReady(db, id, {
      audioPath: "audio/abc.mp3",
      metas: { bpm: 100, duration: 30, keyscale: "C Major" },
      seedValue: "123,456",
      ditModel: "acestep-v15-sft",
      lmModel: "acestep-5Hz-lm-1.7B",
    });
    const song = getSong(db, id)!;
    expect(song.status).toBe("ready");
    expect(song.audioPath).toBe("audio/abc.mp3");
    expect(song.readyAt).toBeGreaterThan(0);
    expect(song.metas).toEqual({ bpm: 100, duration: 30, keyscale: "C Major" });
    expect(song.seedValue).toBe("123,456");
    expect(song.ditModel).toBe("acestep-v15-sft");
    expect(song.lmModel).toBe("acestep-5Hz-lm-1.7B");
  });
});

describe("markFailed", () => {
  it("sets status=failed and stores error", () => {
    const db = makeTestDb();
    const id = insertSong(db, { taskId: "t1", title: "", prompt: "p", lyrics: "", advanced: {} });
    markFailed(db, id, "GPU OOM");
    const song = getSong(db, id)!;
    expect(song.status).toBe("failed");
    expect(song.error).toBe("GPU OOM");
    expect(song.readyAt).toBeNull();
  });
});

describe("listSongs / listPendingSongs / deleteSong", () => {
  it("lists songs newest-first", () => {
    const db = makeTestDb();
    const id1 = insertSong(db, { taskId: "t1", title: "", prompt: "p1", lyrics: "", advanced: {} });
    const id2 = insertSong(db, { taskId: "t2", title: "", prompt: "p2", lyrics: "", advanced: {} });
    const songs = listSongs(db);
    expect(songs).toHaveLength(2);
    expect(songs[0].id).toBe(id2);
    expect(songs[1].id).toBe(id1);
  });

  it("lists only pending songs", () => {
    const db = makeTestDb();
    const id1 = insertSong(db, { taskId: "t1", title: "", prompt: "p1", lyrics: "", advanced: {} });
    const id2 = insertSong(db, { taskId: "t2", title: "", prompt: "p2", lyrics: "", advanced: {} });
    markFailed(db, id2, "err");
    const pending = listPendingSongs(db);
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(id1);
  });

  it("deletes a song and returns true; false for missing", () => {
    const db = makeTestDb();
    const id = insertSong(db, { taskId: "t1", title: "", prompt: "p1", lyrics: "", advanced: {} });
    expect(deleteSong(db, id)).toBe(true);
    expect(getSong(db, id)).toBeNull();
    expect(deleteSong(db, "nonexistent")).toBe(false);
  });
});