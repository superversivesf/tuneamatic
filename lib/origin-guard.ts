export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // non-browser clients (curl, tests) send no Origin
  try {
    const originUrl = new URL(origin);
    const host = req.headers.get("host");
    return !!host && originUrl.host === host;
  } catch {
    return false; // malformed Origin — reject
  }
}