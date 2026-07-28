import { NextResponse } from "next/server";
import { getDb } from "@/lib/app-db";
import { getClient } from "@/lib/app-client";
import { insertSong } from "@/lib/db";
import type { AdvancedParams } from "@/lib/types";

export async function POST(req: Request): Promise<Response> {
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

  const title: string = (body?.title ?? "").toString().trim();
  const lyrics: string = (body?.lyrics ?? "").toString();
  const advanced: AdvancedParams = body?.advanced ?? {};

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

  try {
    const client = getClient();
    const { taskId } = await client.releaseTask(payload);
    const db = getDb();
    const id = insertSong(db, { taskId, title, prompt, lyrics, advanced });
    return NextResponse.json({ id }, { status: 200 });
  } catch (err: any) {
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
    return NextResponse.json(
      { error: `ACE-Step error: ${msg}` },
      { status: 503 }
    );
  }
}