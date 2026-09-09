import dns from "node:dns/promises";
import net from "node:net";
import { FlowFetchError } from "../types/index.js";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

// Private / loopback / link-local / metadata ranges. FlowFetch only ever
// fetches media a user pastes, so it must never be able to reach internal
// infrastructure (SSRF).
function isDisallowedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    const [a, b] = parts;
    if (a === 127) return true; // loopback
    if (a === 10) return true; // private
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 169 && b === 254) return true; // link-local / cloud metadata
    if (a === 0) return true;
    if (a >= 224) return true; // multicast/reserved
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === "::1") return true; // loopback
    if (lower.startsWith("fe80")) return true; // link-local
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local
    return false;
  }
  return true; // not a recognizable IP -> reject to be safe
}

export function isSyntacticallyValidUrl(raw: string): URL | null {
  try {
    const url = new URL(raw.trim());
    if (!ALLOWED_PROTOCOLS.has(url.protocol)) return null;
    if (!url.hostname) return null;
    return url;
  } catch {
    return null;
  }
}

/**
 * Validates a user-supplied URL: correct shape, allowed protocol, and a
 * hostname that does not resolve to internal/private network space.
 * Throws FlowFetchError on anything unsafe or malformed.
 */
export async function assertSafeMediaUrl(raw: string): Promise<URL> {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new FlowFetchError("INVALID_URL", "Please paste a video URL.", 400);
  }
  if (raw.length > 2048) {
    throw new FlowFetchError("INVALID_URL", "That URL is too long.", 400);
  }

  const url = isSyntacticallyValidUrl(raw);
  if (!url) {
    throw new FlowFetchError(
      "INVALID_URL",
      "That doesn't look like a valid http(s) URL.",
      400
    );
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");

  if (hostname === "localhost" || hostname.endsWith(".local")) {
    throw new FlowFetchError(
      "UNSAFE_TARGET",
      "This URL points to a local address and can't be processed.",
      400
    );
  }

  // If the hostname is already a literal IP, check it directly.
  if (net.isIP(hostname)) {
    if (isDisallowedIp(hostname)) {
      throw new FlowFetchError(
        "UNSAFE_TARGET",
        "This URL points to a restricted network address.",
        400
      );
    }
    return url;
  }

  // Otherwise resolve DNS and check every address it maps to.
  try {
    const records = await dns.lookup(hostname, { all: true, verbatim: false });
    if (records.length === 0) {
      throw new FlowFetchError(
        "UNSAFE_TARGET",
        "We couldn't resolve that host.",
        400
      );
    }
    for (const record of records) {
      if (isDisallowedIp(record.address)) {
        throw new FlowFetchError(
          "UNSAFE_TARGET",
          "This URL points to a restricted network address.",
          400
        );
      }
    }
  } catch (err) {
    if (err instanceof FlowFetchError) throw err;
    throw new FlowFetchError(
      "UNSAFE_TARGET",
      "We couldn't resolve that host.",
      400
    );
  }

  return url;
}
