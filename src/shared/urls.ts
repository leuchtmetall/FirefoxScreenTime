/** The hostname of an HTTP(S) URL without a trailing dot; `URL` has already lower-cased it. */
function webHostname(url: URL): string | undefined {
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  return url.hostname.replace(/\.$/, "");
}

export function normalizeHostname(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("A hostname cannot be empty.");

  const candidate = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error(`Invalid URL or hostname: ${value}`);
  }

  const hostname = webHostname(url);
  if (hostname === undefined) {
    throw new Error(`Only HTTP and HTTPS URLs can be tracked: ${value}`);
  }
  if (!hostname) throw new Error(`Invalid hostname: ${value}`);
  return hostname;
}

export function normalizeHostnames(values: string[]): string[] {
  return [...new Set(values.map(normalizeHostname))].sort();
}

export function hostnameFromUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return webHostname(new URL(value));
  } catch {
    return undefined;
  }
}

export function hostnameMatches(hostname: string, configured: string): boolean {
  return hostname === configured || hostname.endsWith(`.${configured}`);
}

export function isTrackedUrl(value: string | undefined, hostnames: string[]): boolean {
  const hostname = hostnameFromUrl(value);
  return (
    hostname !== undefined && hostnames.some((configured) => hostnameMatches(hostname, configured))
  );
}
