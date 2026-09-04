import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { makeTestDb } from "@/lib/test-helpers";
import { insertSong } from "@/lib/db";
import { cleanupOrphanAudio } from "@/lib/janitor";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const storageDir = "/tmp/tuneamatic-janitor-test";

beforeEach(() => {
  rmSync(storageDir, { recursive: true, force: true });
  mkdirSync(join(storageDir, "audio"), { recursive: true });
});

afterAll(() => rmSync(storageDir, { recursive: true, force: true }));

describe("cleanupOrphanAudio", () => {
  it("deletes orphaned audio files, keeps files with a DB row", async () => {
    const db = makeTestDb();
    const id = insertSong(db, { taskId: "t1", title: "", prompt: "p", lyrics: "", advanced: {} });
    writeFileSync(join(storageDir, "audio", `${id}.mp3`), Buffer.alloc(4));
    writeFileSync(join(storageDir, "audio", "orphanedId.mp3"), Buffer.alloc(4));
    const removed = await cleanupOrphanAudio(db, { storageDir });
    expect(removed).toBe(1);
    expect(existsSync(join(storageDir, "audio", `${id}.mp3`))).toBe(true);
    expect(existsSync(join(storageDir, "audio", "orphanedId.mp3"))).toBe(false);
  });

  it("handles a missing audio directory gracefully", async () => {
    const db = makeTestDb();
    rmSync(join(storageDir, "audio"), { recursive: true, force: true });
    expect(await cleanupOrphanAudio(db, { storageDir })).toBe(0);
  });
});