export type SongStatus = "pending" | "ready" | "failed";

export interface AdvancedParams {
  duration?: number;
  bpm?: number;
  keyScale?: string;
  timeSignature?: string;
  seed?: number;
  batchSize?: number;
  thinking?: boolean;
  inferenceSteps?: number;
  guidanceScale?: number;
  cotCaption?: boolean;
}

export interface GenerateRequest {
  prompt: string;
  lyrics?: string;
  advanced?: AdvancedParams;
}

export interface GenerateResponse {
  id: string;
}

export interface Song {
  id: string;
  taskId: string;
  status: SongStatus;
  title: string;
  prompt: string;
  lyrics: string;
  advanced: AdvancedParams;
  audioPath: string | null;
  error: string | null;
  createdAt: number;
  readyAt: number | null;
  metas: SongMetas | null;
  seedValue: string | null;
  ditModel: string | null;
  lmModel: string | null;
}

export interface SongMetas {
  bpm?: number;
  duration?: number;
  genres?: string;
  keyscale?: string;
  timesignature?: string;
  prompt?: string;
  lyrics?: string;
}

export interface SongApiResponse {
  id: string;
  status: SongStatus;
  title: string;
  prompt: string;
  lyrics: string;
  advanced: AdvancedParams;
  createdAt: number;
  readyAt: number | null;
  error: string | null;
  audioUrl: string | null;
  metas: SongMetas | null;
  seedValue: string | null;
  ditModel: string | null;
  lmModel: string | null;
}