export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startPoller } = await import("@/lib/poller");
    const { cleanupOrphanAudio } = await import("@/lib/janitor");
    const { deleteExpiredReserved } = await import("@/lib/db");
    const { getDb } = await import("@/lib/app-db");
    startPoller();
    const db = getDb();
    deleteExpiredReserved(db, 5 * 60 * 1000);
    const removed = await cleanupOrphanAudio(db);
    console.log(`[instrumentation] poller started, janitor removed ${removed} orphaned files`);
  }
}