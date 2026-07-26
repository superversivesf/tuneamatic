import Database from "better-sqlite3";
import { initDb } from "@/lib/db";

export function makeTestDb(): Database.Database {
  const db = initDb(":memory:");
  return db;
}