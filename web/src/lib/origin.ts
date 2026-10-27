export function isSameOrigin(origin: string | null, host: string | null, protocol: string) {
  if (!origin || !host) return false;
  try {
    const url = new URL(origin);
    return url.host === host && url.protocol === protocol && url.origin === origin;
  } catch {
    return false;
  }
}
