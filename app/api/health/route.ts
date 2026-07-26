import { NextResponse } from "next/server";
import { getClient } from "@/lib/app-client";

export async function GET(): Promise<Response> {
  const client = getClient();
  const reachable = await client.ping();
  return NextResponse.json({ ok: true, acestepReachable: reachable });
}