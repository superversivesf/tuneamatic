import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeTestDb } from "@/lib/test-helpers";
import { insertSong, getSong } from "@/lib/db";

const writeMock = vi.fn<(path: string, data: Buffer) => void>();
const mkdirMock = vi.fn<(path: string, opts?: any) => void>();

vi.mock("node:fs", () => ({
  writeFileSync: writeMock,
  mkdirSync: mkdirMock,
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
});

describe("startPoller / stopPoller", () => {
  it("is idempotent — startPoller twice only starts one interval", () => {
    startPoller();
    startPoller();
    stopPoller();
  });

  it("stopPoller resets the flag so startPoller can run again", () => {
    startPoller();
    stopPoller();
    startPoller();
    stopPoller();
  });
});