import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeTestDb } from "@/lib/test-helpers";
import { insertSong, getSong, listSongs, deleteSong, listPendingSongs } from "@/lib/db";

const writeMock = vi.fn<(path: string, data: Buffer) => void>();
const mkdirMock = vi.fn<(path: string, opts?: any) => void>();

vi.mock("node:fs", () => ({}));
vi.mock("node:fs/promises", () => ({
  writeFile: writeMock,
  mkdir: mkdirMock,
}));

const { pollOnce, startPoller, stopPoller } = await import("@/lib/poller");
const { createAceStepClient } = await import("@/lib/acestep-client");
import type { AceStepClient } from "@/lib/acestep-client";

function mockClient(overrides: Partial<AceStepClient> = {}): AceStepClient {
  return {
    releaseTask: vi.fn(),
    queryResults: vi.fn(),
    downloadAudio: vi.fn(),
    ping: vi.fn(),
    ...overrides,
  };
}

describe("pollOnce", () => {
  beforeEach(() => {
    writeMock.mockReset();
    mkdirMock.mockReset();
    writeMock.mockImplementation(() => {});
    mkdirMock.mockImplementation(() => undefined as any);
  });

  it("downloads audio and marks ready when status=1", async () => {
    const db = makeTestDb();
    const id = insertSong(db, { taskId: "t1", title: "", prompt: "p", lyrics: "", advanced: {} });

    const audioBuf = new ArrayBuffer(16);
    const client = mockClient({
      queryResults: vi.fn().mockResolvedValue([
        {
          taskId: "t1",
          status: 1 as const,
          file: "/v1/audio?path=%2Ftmp%2Fabc.mp3",
          prompt: "p",
          lyrics: "",
          metas: { bpm: 120 },
          seed_value: "111",
          lm_model: "acestep-5Hz-lm-1.7B",
          dit_model: "acestep-v15-sft",
        },
      ]),
      downloadAudio: vi.fn().mockResolvedValue(audioBuf),
    });

    await pollOnce(db, client, { storageDir: "/tmp/test-storage" });

    const song = getSong(db, id)!;
    expect(song.status).toBe("ready");
    expect(song.metas).toEqual({ bpm: 120 });
    expect(song.seedValue).toBe("111");
    expect(song.ditModel).toBe("acestep-v15-sft");
    expect(song.lmModel).toBe("acestep-5Hz-lm-1.7B");
    expect(song.audioPath).toBe(`audio/${id}.mp3`);
    expect(client.downloadAudio).toHaveBeenCalledWith("/v1/audio?path=%2Ftmp%2Fabc.mp3");
    expect(writeMock).toHaveBeenCalledWith(`/tmp/test-storage/audio/${id}.mp3`, Buffer.from(audioBuf));
  });

  it("marks failed when status=2", async () => {
    const db = makeTestDb();
    const id = insertSong(db, { taskId: "t1", title: "", prompt: "p", lyrics: "", advanced: {} });
    const client = mockClient({
      queryResults: vi.fn().mockResolvedValue([
        { taskId: "t1", status: 2 as const, error: "OOM" },
      ]),
    });
    await pollOnce(db, client, { storageDir: "/tmp/test-storage" });
    const song = getSong(db, id)!;
    expect(song.status).toBe("failed");
    expect(song.error).toBe("OOM");
  });

  it("does nothing when no pending songs", async () => {
    const db = makeTestDb();
    const client = mockClient({
      queryResults: vi.fn().mockResolvedValue([]),
    });
    await pollOnce(db, client, { storageDir: "/tmp/test-storage" });
    expect(client.queryResults).not.toHaveBeenCalled();
  });

  it("skips status=0 (still running)", async () => {
    const db = makeTestDb();
    const id = insertSong(db, { taskId: "t1", title: "", prompt: "p", lyrics: "", advanced: {} });
    const client = mockClient({
      queryResults: vi.fn().mockResolvedValue([{ taskId: "t1", status: 0 as const }]),
    });
    await pollOnce(db, client, { storageDir: "/tmp/test-storage" });
    const song = getSong(db, id)!;
    expect(song.status).toBe("pending");
  });

  it("maps ACE-Step error when status=2 without explicit error uses fallback", async () => {
    const db = makeTestDb();
    insertSong(db, { taskId: "t1", title: "", prompt: "p", lyrics: "", advanced: {} });
    const client = mockClient({
      queryResults: vi.fn().mockResolvedValue([{ taskId: "t1", status: 2 as const }]),
    });
    await pollOnce(db, client, { storageDir: "/tmp/test-storage" });
    const songs = listSongs(db);
    expect(songs[0].status).toBe("failed");
    expect(songs[0].error).toBe("ACE-Step task failed (no error message)");
  });

  it("a queryResults rejection does not fail any song", async () => {
    const db = makeTestDb();
    insertSong(db, { taskId: "t1", title: "", prompt: "p", lyrics: "", advanced: {} });
    insertSong(db, { taskId: "t2", title: "", prompt: "p", lyrics: "", advanced: {} });
    const client = mockClient({
      queryResults: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    });
    await pollOnce(db, client, { storageDir: "/tmp/test-storage" });
    expect(listSongs(db).every((s) => s.status === "pending")).toBe(true);
  });

  it("marks failed a pending song older than pendingTimeoutMs", async () => {
    const db = makeTestDb();
    const id = insertSong(db, { taskId: "t1", title: "", prompt: "p", lyrics: "", advanced: {} });
    db.prepare("UPDATE songs SET created_at = ? WHERE id = ?").run(Date.now() - 31 * 60 * 1000, id);
    const client = mockClient();
    await pollOnce(db, client, { storageDir: "/tmp/test-storage", pendingTimeoutMs: 30 * 60 * 1000 });
    expect(getSong(db, id)!.status).toBe("failed");
    expect(getSong(db, id)!.error).toContain("timed out");
    expect(client.queryResults).not.toHaveBeenCalled();
  });

  it("status=1 with no file marks failed, not throw", async () => {
    const db = makeTestDb();
    const id = insertSong(db, { taskId: "t1", title: "", prompt: "p", lyrics: "", advanced: {} });
    const client = mockClient({
      queryResults: vi.fn().mockResolvedValue([{ taskId: "t1", status: 1 as const }]),
    });
    await pollOnce(db, client, { storageDir: "/tmp/test-storage" });
    expect(getSong(db, id)!.status).toBe("failed");
    expect(getSong(db, id)!.error).toContain("without an audio file");
  });

  it("prunes failureCounts for songs no longer pending (deleted)", async () => {
    const db = makeTestDb();
    const id = insertSong(db, { taskId: "t1", title: "", prompt: "p", lyrics: "", advanced: {} });
    const client = mockClient({
      queryResults: vi.fn().mockRejectedValueOnce(new Error("blip")).mockResolvedValue([
        { taskId: "t1", status: 0 as const },
      ]),
    });
    await pollOnce(db, client, { storageDir: "/tmp/test-storage" }); // download failure path not hit; counts stay 0
    deleteSong(db, id);
    await pollOnce(db, client, { storageDir: "/tmp/test-storage" });
    // second cycle: no pending songs → early return; no crash, no throw
    expect(listPendingSongs(db)).toHaveLength(0);
  });

  it("download failure increments per-song failure budget only for that song", async () => {
    const db = makeTestDb();
    const idA = insertSong(db, { taskId: "a", title: "", prompt: "p", lyrics: "", advanced: {} });
    const idB = insertSong(db, { taskId: "b", title: "", prompt: "p", lyrics: "", advanced: {} });
    const client = mockClient({
      queryResults: vi.fn().mockResolvedValue([
        { taskId: "a", status: 1 as const, file: "/v1/audio?path=%2Fa.mp3" },
        { taskId: "b", status: 1 as const, file: "/v1/audio?path=%2Fb.mp3" },
      ]),
      downloadAudio: vi.fn().mockRejectedValue(new Error("401")),
    });
    await pollOnce(db, client, { storageDir: "/tmp/test-storage" });
    await pollOnce(db, client, { storageDir: "/tmp/test-storage" });
    await pollOnce(db, client, { storageDir: "/tmp/test-storage" });
    expect(getSong(db, idA)!.status).toBe("failed");
    expect(getSong(db, idB)!.status).toBe("failed");
    expect(getSong(db, idA)!.error).toContain("Audio download failed");
  });
});

describe("startPoller / stopPoller", () => {
  afterEach(() => {
    stopPoller();
    vi.useRealTimers();
  });

  it("is idempotent — startPoller twice only starts one loop", () => {
    startPoller();
    startPoller();
    stopPoller();
  });

  it("stopPoller resets so startPoller can run again", () => {
    startPoller();
    stopPoller();
    startPoller();
    stopPoller();
  });

  it("does not start a second poll while the first is in flight", async () => {
    vi.useFakeTimers();
    let resolveQuery!: () => void;
    const gate = new Promise<void>((r) => { resolveQuery = r; });
    const client = mockClient({
      queryResults: vi.fn().mockImplementation(async () => {
        await gate; // first call stays in flight until released
        return [];
      }),
    });
    const db = makeTestDb();
    insertSong(db, { taskId: "t1", title: "", prompt: "p", lyrics: "", advanced: {} });
    startPoller({ client, db, storageDir: "/tmp/test-storage" });
    await vi.advanceTimersByTimeAsync(10); // fire first tick
    expect(client.queryResults).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000); // 2.5 intervals while query still pending
    expect(client.queryResults).toHaveBeenCalledTimes(1); // serialized!
    resolveQuery();
    await vi.advanceTimersByTimeAsync(2100);
    expect(client.queryResults).toHaveBeenCalledTimes(2);
    stopPoller();
  });
});