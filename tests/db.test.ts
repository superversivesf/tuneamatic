import { describe, it, expect } from "vitest";
import { makeTestDb } from "@/lib/test-helpers";
import { insertSong, getSong, markReady, markFailed, listSongs, listPendingSongs, deleteSong, insertReservedSong, activateSong, deleteExpiredReserved } from "@/lib/db";

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

describe("status transition guards", () => {
  it("markFailed after markReady is a no-op returning false", () => {
    const db = makeTestDb();
    const id = insertSong(db, { taskId: "t1", title: "", prompt: "p", lyrics: "", advanced: {} });
    expect(markReady(db, id, { audioPath: "audio/x.mp3", metas: {}, seedValue: "", ditModel: "", lmModel: "" })).toBe(true);
    expect(markFailed(db, id, "late failure")).toBe(false);
    expect(getSong(db, id)!.status).toBe("ready");
    expect(getSong(db, id)!.error).toBeNull();
  });

  it("markReady after markFailed is a no-op returning false", () => {
    const db = makeTestDb();
    const id = insertSong(db, { taskId: "t1", title: "", prompt: "p", lyrics: "", advanced: {} });
    expect(markFailed(db, id, "boom")).toBe(true);
    expect(markReady(db, id, { audioPath: "audio/x.mp3", metas: {}, seedValue: "", ditModel: "", lmModel: "" })).toBe(false);
    expect(getSong(db, id)!.status).toBe("failed");
  });

  it("markReady on nonexistent id returns false", () => {
    const db = makeTestDb();
    expect(markReady(db, "nope", { audioPath: "a", metas: {}, seedValue: "", ditModel: "", lmModel: "" })).toBe(false);
    expect(markFailed(db, "nope", "x")).toBe(false);
  });
});

describe("reserved lifecycle", () => {
  const base = { title: "T", prompt: "p", lyrics: "l", advanced: {} };

  it("insertReservedSong → pending is invisible; activateSong flips to pending", () => {
    const db = makeTestDb();
    const id = insertReservedSong(db, base);
    expect(getSong(db, id)!.status).toBe("reserved");
    expect(getSong(db, id)!.taskId).toBe("reserved");
    expect(listPendingSongs(db)).toHaveLength(0);
    expect(activateSong(db, id, "task-9")).toBe(true);
    const s = getSong(db, id)!;
    expect(s.status).toBe("pending");
    expect(s.taskId).toBe("task-9");
  });

  it("activateSong is a no-op on a pending row", () => {
    const db = makeTestDb();
    const id = insertSong(db, { taskId: "t1", title: "", prompt: "p", lyrics: "", advanced: {} });
    expect(activateSong(db, id, "other")).toBe(false);
    expect(getSong(db, id)!.taskId).toBe("t1");
  });

  it("deleteExpiredReserved removes stale reserved rows, keeps fresh ones and non-reserved", () => {
    const db = makeTestDb();
    const fresh = insertReservedSong(db, base);
    db.prepare("UPDATE songs SET created_at = ? WHERE id = ?").run(Date.now() - 10 * 60 * 1000, fresh);
    const kept = insertSong(db, { taskId: "t1", title: "", prompt: "p", lyrics: "", advanced: {} });
    db.prepare("UPDATE songs SET created_at = ? WHERE id = ?").run(Date.now() - 10 * 60 * 1000, kept);
    deleteExpiredReserved(db, 5 * 60 * 1000);
    expect(getSong(db, fresh)).toBeNull();
    expect(getSong(db, kept)).not.toBeNull();
  });
});

describe("listSongs limit", () => {
  it("returns at most 500 rows by default, newest first", () => {
    const db = makeTestDb();
    for (let i = 0; i < 3; i++) {
      insertSong(db, { taskId: `t${i}`, title: String(i), prompt: "p", lyrics: "", advanced: {} });
    }
    const rows = listSongs(db);
    expect(rows).toHaveLength(3);
    expect(rows[0].title).toBe("2");
    expect(listSongs(db, 2)).toHaveLength(2);
  });
});