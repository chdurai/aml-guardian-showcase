export function isSameOrigin(origin: string | null, host: string | null, protocol: string, forwardedProto?: string | null) {
  if (!origin || !host) return false;
  try {
    const url = new URL(origin);
    // Behind a TLS-terminating proxy (Azure Container Apps, Render) the app sees
    // http while the browser used https; trust the proxy's forwarded protocol.
    const effectiveProtocol = forwardedProto ? `${forwardedProto.split(",")[0].trim()}:` : protocol;
    return url.host === host && url.protocol === effectiveProtocol && url.origin === origin;
  } catch {
    return false;
  }
}
