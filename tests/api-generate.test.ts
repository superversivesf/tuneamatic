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

describe("origin guard", () => {
  it("rejects cross-origin POST with 403", async () => {
    const req = new Request("http://localhost:5433/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://evil.example", Host: "localhost:5433" },
      body: JSON.stringify({ prompt: "pop" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("allows same-origin POST", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ data: { task_id: "ace-1" }, code: 200 }),
    });
    const req = new Request("http://localhost:5433/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:5433", Host: "localhost:5433" },
      body: JSON.stringify({ prompt: "pop" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });
});

describe("input validation", () => {
  it("rejects prompt over 2000 chars", async () => {
    const res = await POST(makeReq({ prompt: "x".repeat(2001) }));
    expect(res.status).toBe(400);
  });

  it("rejects lyrics over 20000 chars", async () => {
    const res = await POST(makeReq({ prompt: "ok", lyrics: "x".repeat(20001) }));
    expect(res.status).toBe(400);
  });

  it("rejects title over 200 chars", async () => {
    const res = await POST(makeReq({ prompt: "ok", title: "x".repeat(201) }));
    expect(res.status).toBe(400);
  });

  it("rejects out-of-range advanced params", async () => {
    expect((await POST(makeReq({ prompt: "ok", advanced: { duration: 601 } }))).status).toBe(400);
    expect((await POST(makeReq({ prompt: "ok", advanced: { duration: 5 } }))).status).toBe(400);
    expect((await POST(makeReq({ prompt: "ok", advanced: { bpm: 301 } }))).status).toBe(400);
    expect((await POST(makeReq({ prompt: "ok", advanced: { bpm: 29 } }))).status).toBe(400);
    expect((await POST(makeReq({ prompt: "ok", advanced: { batchSize: 9 } }))).status).toBe(400);
    expect((await POST(makeReq({ prompt: "ok", advanced: { batchSize: 0 } }))).status).toBe(400);
  });
});

describe("reserved-first flow", () => {
  it("inserts a reserved row before releaseTask and activates after", async () => {
    const rows = () => getDb().prepare("SELECT * FROM songs ORDER BY rowid DESC LIMIT 1").get() as any;
    mockFetch.mockImplementationOnce(async () => {
      const row = rows();
      expect(row).toBeTruthy();
      expect(row.status).toBe("reserved"); // row exists BEFORE releaseTask resolves
      return { ok: true, status: 200, json: async () => ({ data: { task_id: "ace-2" }, code: 200 }) };
    });
    const res = await POST(makeReq({ prompt: "pop" }));
    expect(res.status).toBe(200);
    const row = rows();
    expect(row.status).toBe("pending");
    expect(row.task_id).toBe("ace-2");
  });

  it("deletes the reserved row when releaseTask fails", async () => {
    const before = (getDb().prepare("SELECT COUNT(*) c FROM songs").get() as any).c;
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const res = await POST(makeReq({ prompt: "pop" }));
    expect(res.status).toBe(503);
    const after = (getDb().prepare("SELECT COUNT(*) c FROM songs").get() as any).c;
    expect(after).toBe(before);
  });

  it("returns a generic error message on upstream failure (no err echo)", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, text: async () => "SECRET-UPSTREAM-DETAILS" });
    const res = await POST(makeReq({ prompt: "pop" }));
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body.error).not.toContain("SECRET-UPSTREAM-DETAILS");
  });
});