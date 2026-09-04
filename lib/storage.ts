import { join } from "node:path";

export function getStorageDir(): string {
  return process.env.TUNEAMATIC_STORAGE_DIR
    ?? join(process.cwd(), "storage");
}