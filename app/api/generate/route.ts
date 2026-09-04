import { NextResponse } from "next/server";
import { getDb } from "@/lib/app-db";
import { getClient } from "@/lib/app-client";
import { insertReservedSong, activateSong } from "@/lib/db";
import { isSameOrigin } from "@/lib/origin-guard";
import type { AdvancedParams } from "@/lib/types";

const MAX_PROMPT = 2000;
const MAX_LYRICS = 20000;
const MAX_TITLE = 200;

export async function POST(req: Request): Promise<Response> {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const prompt: string = (body?.prompt ?? "").toString().trim();
  if (!prompt) {
    return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  }
  if (prompt.length > MAX_PROMPT) {
    return NextResponse.json({ error: `prompt must be at most ${MAX_PROMPT} characters` }, { status: 400 });
  }

  const title: string = (body?.title ?? "").toString().trim();
  if (title.length > MAX_TITLE) {
    return NextResponse.json({ error: `title must be at most ${MAX_TITLE} characters` }, { status: 400 });
  }

  const lyrics: string = (body?.lyrics ?? "").toString();
  if (lyrics.length > MAX_LYRICS) {
    return NextResponse.json({ error: `lyrics must be at most ${MAX_LYRICS} characters` }, { status: 400 });
  }

  const advanced: AdvancedParams = body?.advanced ?? {};
  if (advanced.duration !== undefined && (advanced.duration < 10 || advanced.duration > 600)) {
    return NextResponse.json({ error: "duration must be between 10 and 600 seconds" }, { status: 400 });
  }
  if (advanced.bpm !== undefined && (advanced.bpm < 30 || advanced.bpm > 300)) {
    return NextResponse.json({ error: "bpm must be between 30 and 300" }, { status: 400 });
  }
  if (advanced.batchSize !== undefined && (advanced.batchSize < 1 || advanced.batchSize > 8)) {
    return NextResponse.json({ error: "batchSize must be between 1 and 8" }, { status: 400 });
  }

  const payload: any = {
    prompt,
    lyrics,
    thinking: advanced.thinking !== undefined ? advanced.thinking : true,
  };
  if (advanced.duration !== undefined) payload.audio_duration = advanced.duration;
  if (advanced.bpm !== undefined) payload.bpm = advanced.bpm;
  if (advanced.keyScale) payload.key_scale = advanced.keyScale;
  if (advanced.timeSignature) payload.time_signature = advanced.timeSignature;
  if (advanced.seed !== undefined) payload.seed = advanced.seed;
  if (advanced.batchSize !== undefined) payload.batch_size = advanced.batchSize;
  if (advanced.inferenceSteps !== undefined) payload.inference_steps = advanced.inferenceSteps;
  if (advanced.guidanceScale !== undefined) payload.guidance_scale = advanced.guidanceScale;
  if (advanced.cotCaption !== undefined) payload.use_cot_caption = advanced.cotCaption;

  const db = getDb();
  const id = insertReservedSong(db, { title, prompt, lyrics, advanced });
  try {
    const client = getClient();
    const { taskId } = await client.releaseTask(payload);
    activateSong(db, id, taskId);
    return NextResponse.json({ id }, { status: 200 });
  } catch (err: any) {
    db.prepare("DELETE FROM songs WHERE id = ? AND status = 'reserved'").run(id);
    const msg = err?.message ?? String(err);
    if (/ECONNREFUSED|fetch failed/i.test(msg)) {
      return NextResponse.json(
        { error: "ACE-Step server unreachable. Run ./scripts/start-acestep.sh" },
        { status: 503 }
      );
    }
    if (err?.status === 429) {
      return NextResponse.json(
        { error: "ACE-Step server busy, try again in a moment" },
        { status: 503 }
      );
    }
    console.error("[generate] ACE-Step error:", err);
    return NextResponse.json(
      { error: "Music generation failed. Please try again." },
      { status: 503 }
    );
  }
}