import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.TUNEAMATIC_DB = join(mkdtempSync(join(tmpdir(), "tuneamatic-test-")), "test.db");

import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/generate/route";
import { getDb } from "@/lib/app-db";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
  getDb().exec("DELETE FROM songs");
});

function makeReq(body: any): Request {
  return new Request("http://localhost:5433/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/generate", () => {
  it("returns 200 with id on success", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: { task_id: "ace-1" }, code: 200 }),
    });

    const res = await POST(makeReq({ prompt: "pop song", lyrics: "la la" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toMatch(/^[A-Za-z0-9_-]{10,}$/);
  });

  it("returns 400 when prompt is empty", async () => {
    const res = await POST(makeReq({ prompt: "" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when prompt is missing", async () => {
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
  });

  it("returns 503 when ACE-Step is unreachable", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const res = await POST(makeReq({ prompt: "pop" }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toContain("ACE-Step");
  });

  it("returns 503 when ACE-Step returns 429", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429, text: async () => "busy" });
    const res = await POST(makeReq({ prompt: "pop" }));
    expect(res.status).toBe(503);
  });
});