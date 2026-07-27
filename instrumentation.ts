export async function register() {
  console.log("[instrumentation] register() called, NEXT_RUNTIME =", process.env.NEXT_RUNTIME);
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startPoller } = await import("@/lib/poller");
    startPoller();
    console.log("[instrumentation] poller started");
  }
}