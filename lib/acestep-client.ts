export interface ReleaseTaskPayload {
  prompt: string;
  lyrics: string;
  thinking: true;
  audio_duration?: number;
  bpm?: number;
  key_scale?: string;
  time_signature?: string;
  seed?: number;
  batch_size?: number;
}

export interface QueryResult {
  taskId: string;
  status: 0 | 1 | 2;
  file?: string;
  prompt?: string;
  lyrics?: string;
  metas?: Record<string, unknown>;
  seed_value?: string;
  lm_model?: string;
  dit_model?: string;
  error?: string;
}

export class AceStepError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "AceStepError";
  }
}

export interface AceStepClient {
  releaseTask(payload: ReleaseTaskPayload): Promise<{ taskId: string }>;
  queryResults(taskIds: string[]): Promise<QueryResult[]>;
  downloadAudio(path: string): Promise<ArrayBuffer>;
  ping(): Promise<boolean>;
}

export function createAceStepClient(opts: {
  baseUrl: string;
  apiKey?: string;
}): AceStepClient {
  const { baseUrl, apiKey } = opts;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  async function releaseTask(payload: ReleaseTaskPayload): Promise<{ taskId: string }> {
    const res = await fetch(`${baseUrl}/release_task`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new AceStepError(res.status, `ACE-Step release_task failed: ${res.status} ${body}`);
    }
    const json = await res.json();
    const taskId: string | undefined = json?.data?.task_id;
    if (!taskId) throw new AceStepError(res.status, "ACE-Step returned no task_id");
    return { taskId };
  }

  async function queryResults(taskIds: string[]): Promise<QueryResult[]> {
    if (taskIds.length === 0) return [];
    const res = await fetch(`${baseUrl}/query_result`, {
      method: "POST",
      headers,
      body: JSON.stringify({ task_id_list: taskIds }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new AceStepError(res.status, `ACE-Step query_result failed: ${res.status} ${body}`);
    }
    const json = await res.json();
    const rows: any[] = json?.data ?? [];
    return rows.map((r) => {
      let resultObj: any = {};
      if (typeof r.result === "string") {
        try { resultObj = JSON.parse(r.result); } catch { /* leave empty */ }
        if (Array.isArray(resultObj) && resultObj.length > 0) resultObj = resultObj[0];
      }
      return {
        taskId: r.task_id as string,
        status: r.status as 0 | 1 | 2,
        file: resultObj.file,
        prompt: resultObj.prompt,
        lyrics: resultObj.lyrics,
        metas: resultObj.metas,
        seed_value: resultObj.seed_value,
        lm_model: resultObj.lm_model,
        dit_model: resultObj.dit_model,
      };
    });
  }

  async function downloadAudio(path: string): Promise<ArrayBuffer> {
    const url = `${baseUrl}${path}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new AceStepError(res.status, `ACE-Step audio download failed: ${res.status}`);
    }
    return res.arrayBuffer();
  }

  async function ping(): Promise<boolean> {
    try {
      const res = await fetch(`${baseUrl}/health`);
      return res.ok;
    } catch {
      return false;
    }
  }

  return { releaseTask, queryResults, downloadAudio, ping };
}