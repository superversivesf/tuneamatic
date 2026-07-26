import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAceStepClient } from "@/lib/acestep-client";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

describe("acestep-client", () => {
  const client = createAceStepClient({
    baseUrl: "http://localhost:8001",
    apiKey: undefined,
  });

  it("releaseTask sends correct payload and returns taskId", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: { task_id: "abc-123", status: "queued", queue_position: 0 },
        code: 200,
        error: null,
      }),
    });

    const result = await client.releaseTask({
      prompt: "upbeat pop",
      lyrics: "hello",
      thinking: true,
      audio_duration: 60,
    });

    expect(result.taskId).toBe("abc-123");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("http://localhost:8001/release_task");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      prompt: "upbeat pop",
      lyrics: "hello",
      thinking: true,
      audio_duration: 60,
    });
  });

  it("releaseTask throws AceStepError on 429", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429, text: async () => "busy" });
    await expect(client.releaseTask({ prompt: "x", lyrics: "", thinking: true }))
      .rejects.toMatchObject({ status: 429 });
  });

  it("releaseTask throws on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await expect(client.releaseTask({ prompt: "x", lyrics: "", thinking: true }))
      .rejects.toThrow("ECONNREFUSED");
  });
});

describe("queryResults", () => {
  const client = createAceStepClient({ baseUrl: "http://localhost:8001" });

  it("sends batch and parses results", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          {
            task_id: "t1",
            status: 1,
            result: JSON.stringify([{
              file: "/v1/audio?path=%2Ftmp%2Fabc.mp3",
              prompt: "pop",
              lyrics: "la la",
              metas: { bpm: 120, duration: 30 },
              seed_value: "111,222",
              lm_model: "acestep-5Hz-lm-1.7B",
              dit_model: "acestep-v15-sft",
            }]),
          },
          { task_id: "t2", status: 0, result: "[]" },
        ],
        code: 200,
      }),
    });

    const results = await client.queryResults(["t1", "t2"]);
    expect(results).toHaveLength(2);
    expect(results[0].taskId).toBe("t1");
    expect(results[0].status).toBe(1);
    expect(results[0].file).toBe("/v1/audio?path=%2Ftmp%2Fabc.mp3");
    expect(results[0].metas).toEqual({ bpm: 120, duration: 30 });
    expect(results[0].seed_value).toBe("111,222");
    expect(results[1].taskId).toBe("t2");
    expect(results[1].status).toBe(0);
  });

  it("returns empty array for empty input", async () => {
    const results = await client.queryResults([]);
    expect(results).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("downloadAudio", () => {
  const client = createAceStepClient({ baseUrl: "http://localhost:8001" });

  it("fetches raw bytes from the file path", async () => {
    const buf = new ArrayBuffer(8);
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, arrayBuffer: async () => buf });
    const out = await client.downloadAudio("/v1/audio?path=%2Ftmp%2Fabc.mp3");
    expect(out).toBe(buf);
    expect(mockFetch.mock.calls[0][0]).toBe("http://localhost:8001/v1/audio?path=%2Ftmp%2Fabc.mp3");
  });
});

describe("ping", () => {
  const client = createAceStepClient({ baseUrl: "http://localhost:8001" });

  it("returns true on 200", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });
    expect(await client.ping()).toBe(true);
  });

  it("returns false on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    expect(await client.ping()).toBe(false);
  });
});