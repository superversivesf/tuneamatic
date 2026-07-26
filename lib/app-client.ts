import { createAceStepClient, type AceStepClient } from "@/lib/acestep-client";

let clientInstance: AceStepClient | null = null;

export function getClient(): AceStepClient {
  if (!clientInstance) {
    const baseUrl = process.env.ACESTEP_API_URL ?? "http://localhost:8001";
    const apiKey = process.env.ACESTEP_API_KEY || undefined;
    clientInstance = createAceStepClient({ baseUrl, apiKey });
  }
  return clientInstance;
}