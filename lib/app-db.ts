import { initDb } from "@/lib/db";
import { join } from "node:path";
import type { Database } from "better-sqlite3";

let dbInstance: Database | null = null;

export function getDb(): Database {
  if (!dbInstance) {
    dbInstance = initDb(join(process.cwd(), "data", "tuneamatic.db"));
  }
  return dbInstance;
}