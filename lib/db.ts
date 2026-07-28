import Database from "better-sqlite3";
import { nanoid } from "nanoid";
import type { AdvancedParams, Song, SongStatus } from "@/lib/types";

type DB = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS songs (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL,
  status      TEXT NOT NULL,
  title       TEXT NOT NULL DEFAULT '',
  prompt      TEXT NOT NULL,
  lyrics      TEXT NOT NULL DEFAULT '',
  advanced    TEXT NOT NULL DEFAULT '{}',
  audio_path  TEXT,
  error       TEXT,
  created_at  INTEGER NOT NULL,
  ready_at    INTEGER,
  metas       TEXT,
  seed_value  TEXT,
  dit_model   TEXT,
  lm_model    TEXT
);
CREATE INDEX IF NOT EXISTS idx_status ON songs(status);
CREATE INDEX IF NOT EXISTS idx_created ON songs(created_at DESC);
`;

export function initDb(dbPath: string): DB {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  try {
    db.exec("ALTER TABLE songs ADD COLUMN title TEXT NOT NULL DEFAULT ''");
  } catch {
    /* column already exists */
  }
  return db;
}

export function insertSong(
  db: DB,
  input: { taskId: string; title: string; prompt: string; lyrics: string; advanced: AdvancedParams }
): string {
  const id = nanoid();
  const now = Date.now();
  db.prepare(
    `INSERT INTO songs (id, task_id, status, title, prompt, lyrics, advanced, created_at)
     VALUES (?, ?, 'pending', ?, ?, ?, ?, ?)`
  ).run(id, input.taskId, input.title, input.prompt, input.lyrics, JSON.stringify(input.advanced), now);
  return id;
}

function rowToSong(row: any): Song {
  return {
    id: row.id,
    taskId: row.task_id,
    status: row.status as SongStatus,
    title: row.title ?? "",
    prompt: row.prompt,
    lyrics: row.lyrics,
    advanced: JSON.parse(row.advanced),
    audioPath: row.audio_path,
    error: row.error,
    createdAt: row.created_at,
    readyAt: row.ready_at,
    metas: row.metas ? JSON.parse(row.metas) : null,
    seedValue: row.seed_value,
    ditModel: row.dit_model,
    lmModel: row.lm_model,
  };
}

export function getSong(db: DB, id: string): Song | null {
  const row = db.prepare("SELECT * FROM songs WHERE id = ?").get(id);
  return row ? rowToSong(row) : null;
}

export function markReady(
  db: DB,
  id: string,
  fields: {
    audioPath: string;
    metas: Record<string, unknown>;
    seedValue: string;
    ditModel: string;
    lmModel: string;
  }
): void {
  db.prepare(
    `UPDATE songs SET
       status = 'ready',
       audio_path = ?,
       ready_at = ?,
       metas = ?,
       seed_value = ?,
       dit_model = ?,
       lm_model = ?
     WHERE id = ?`
  ).run(
    fields.audioPath,
    Date.now(),
    JSON.stringify(fields.metas),
    fields.seedValue,
    fields.ditModel,
    fields.lmModel,
    id
  );
}

export function markFailed(db: DB, id: string, error: string): void {
  db.prepare(
    `UPDATE songs SET status = 'failed', error = ? WHERE id = ?`
  ).run(error, id);
}

export function listSongs(db: DB): Song[] {
  const rows = db.prepare("SELECT * FROM songs ORDER BY rowid DESC").all();
  return rows.map(rowToSong);
}

export function listPendingSongs(db: DB): Song[] {
  const rows = db.prepare("SELECT * FROM songs WHERE status = 'pending'").all();
  return rows.map(rowToSong);
}

export function deleteSong(db: DB, id: string): boolean {
  const result = db.prepare("DELETE FROM songs WHERE id = ?").run(id);
  return result.changes > 0;
}