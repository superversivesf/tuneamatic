import type { Song, SongApiResponse } from "@/lib/types";

export function toApiResponse(s: Song): SongApiResponse {
  return {
    id: s.id,
    status: s.status,
    prompt: s.prompt,
    lyrics: s.lyrics,
    advanced: s.advanced,
    createdAt: s.createdAt,
    readyAt: s.readyAt,
    error: s.error,
    audioUrl: s.status === "ready" && s.audioPath ? `/api/audio/${s.id}` : null,
    metas: s.metas,
    seedValue: s.seedValue,
    ditModel: s.ditModel,
    lmModel: s.lmModel,
  };
}