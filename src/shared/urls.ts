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

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Only HTTP and HTTPS URLs can be tracked: ${value}`);
  }
  if (!url.hostname) throw new Error(`Invalid hostname: ${value}`);
  return url.hostname.toLowerCase().replace(/\.$/, "");
}

export function normalizeHostnames(values: string[]): string[] {
  return [...new Set(values.map(normalizeHostname))].sort();
}

export function hostnameFromUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return undefined;
  }
}

export function hostnameMatches(hostname: string, configured: string): boolean {
  return hostname === configured || hostname.endsWith(`.${configured}`);
}

export function isTrackedUrl(value: string | undefined, hostnames: string[]): boolean {
  const hostname = hostnameFromUrl(value);
  return hostname !== undefined && hostnames.some((configured) => hostnameMatches(hostname, configured));
}
