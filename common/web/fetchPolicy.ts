/**
 * Where the agent is allowed to go on the network.
 *
 * A tool that fetches a URL on behalf of a model is a server-side request forgery
 * primitive unless it refuses to reach the machine it runs on: `http://localhost`
 * is the app's own shell, `http://169.254.169.254` is cloud metadata, and
 * `10.x`/`192.168.x` are the user's network. The same is true for a **public**
 * hostname that resolves to a private address, which is why the check is done on
 * the resolved addresses and not only on the name.
 *
 * The policy is deliberately narrow and fails closed: anything this module cannot
 * classify as public is refused.
 *
 * ## What this does and does not defend against
 *
 * It stops the obvious and the accidental — a model guessing `localhost`, a
 * redirect into a private range, a hostname resolving to `127.0.0.1`. It does not
 * stop a determined **DNS-rebinding** attack, where the name resolves to a public
 * address for the check and to a private one for the connection: closing that
 * needs the connection to be pinned to the address that was validated, which the
 * platform `fetch` does not expose. Recorded here so nobody mistakes this for a
 * complete boundary.
 *
 * @module common/web/fetchPolicy
 */

import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** Longest URL accepted. Long enough for real links, short enough to bound work. */
const MAX_URL_LENGTH = 2000;

/** Hostnames that always mean "this machine" or a cloud metadata service. */
const BLOCKED_HOSTNAMES: ReadonlySet<string> = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata',
  'metadata.google.internal',
  'instance-data',
]);

/** Suffixes that are private name spaces by convention (RFC 6761 / 8375 / mDNS). */
const BLOCKED_SUFFIXES: readonly string[] = [
  '.localhost',
  '.local',
  '.internal',
  '.home.arpa',
  '.lan',
];

/** Raised when a URL is outside the policy. Carries the message shown to the model. */
export class FetchPolicyError extends Error {
  public override readonly name = 'FetchPolicyError';

  public constructor(message: string) {
    super(message);
  }
}

/**
 * Whether an IPv4 literal is outside the public internet.
 *
 * Anything unparseable counts as private: failing closed is the only safe default
 * for a check whose whole job is to refuse.
 */
export function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }

  const [a = 0, b = 0] = parts;
  if (a === 0 || a === 10 || a === 127) return true; // "this host", RFC 1918, loopback
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC 1918
  if (a === 192 && b === 168) return true; // RFC 1918
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT, RFC 6598
  if (a === 192 && b === 0) return true; // IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast and reserved

  return false;
}

/** Whether an IPv6 literal is outside the public internet. */
export function isPrivateIpv6(address: string): boolean {
  const value = address.toLowerCase().split('%')[0] ?? '';

  if (value === '::' || value === '::1') return true; // unspecified, loopback
  if (value.startsWith('fe80')) return true; // link-local
  if (/^f[cd][0-9a-f]{2}:/.test(value)) return true; // unique local
  if (value.startsWith('ff')) return true; // multicast

  // IPv4-mapped (`::ffff:192.168.0.1`) is as private as the IPv4 it wraps.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
  if (mapped?.[1] !== undefined) return isPrivateIpv4(mapped[1]);

  return false;
}

/** Whether a literal address is outside the public internet. */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family === 6) return isPrivateIpv6(address);
  return true;
}

/**
 * Refuse a hostname that names a private space, by name.
 *
 * Checked before any DNS query so an obvious attempt fails without leaking a
 * lookup to the resolver.
 *
 * @throws {FetchPolicyError} when the host is blocked.
 */
export function assertHostnameAllowed(hostname: string): void {
  const host = hostname.toLowerCase().replace(/\.$/, '');

  if (host === '') {
    throw new FetchPolicyError('The URL has no host.');
  }
  if (BLOCKED_HOSTNAMES.has(host)) {
    throw new FetchPolicyError(`Access to the local network is not allowed: ${host}`);
  }
  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    throw new FetchPolicyError(`Access to the local network is not allowed: ${host}`);
  }
  if (isIP(host) !== 0 && isPrivateAddress(host)) {
    throw new FetchPolicyError(`Access to the local network is not allowed: ${host}`);
  }
}

/** Resolves a hostname to every address it has. Injectable so tests never hit DNS. */
export type DnsLookup = (hostname: string) => Promise<readonly { readonly address: string }[]>;

const defaultLookup: DnsLookup = async (hostname) => {
  const entries = await dnsLookup(hostname, { all: true });
  return entries.map((entry) => ({ address: entry.address }));
};

/**
 * Refuse a hostname that **resolves** into a private space.
 *
 * The name check alone is not enough: `evil.example` can point at `127.0.0.1`.
 *
 * @throws {FetchPolicyError} when any resolved address is private, or resolution
 *   fails — a name that does not resolve cannot be fetched anyway, and reporting
 *   it here gives the model a message it can act on.
 */
export async function assertResolvesPublic(
  hostname: string,
  lookup: DnsLookup = defaultLookup,
): Promise<void> {
  let addresses: readonly { readonly address: string }[];
  try {
    addresses = await lookup(hostname);
  } catch {
    throw new FetchPolicyError(`Could not resolve ${hostname}.`);
  }

  if (addresses.length === 0) {
    throw new FetchPolicyError(`Could not resolve ${hostname}.`);
  }

  for (const entry of addresses) {
    if (isPrivateAddress(entry.address)) {
      throw new FetchPolicyError(`Access to the local network is not allowed: ${hostname}`);
    }
  }
}

/**
 * Validate and normalise a URL supplied by the model.
 *
 * A bare hostname (`example.com/docs`) is accepted and given `https://`, because
 * that is what a model tends to emit; anything that is not `http`/`https` is
 * refused. Credentials in the URL are refused rather than forwarded, and the
 * fragment is dropped because it is never sent to the server anyway.
 *
 * @throws {FetchPolicyError} when the URL is unusable or outside the policy.
 */
export function normalizePublicUrl(raw: unknown): URL {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new FetchPolicyError('Provide a URL.');
  }

  let text = raw.trim();
  if (!/^https?:\/\//i.test(text)) {
    if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(text)) {
      text = `https://${text}`;
    } else {
      throw new FetchPolicyError('The URL must start with http:// or https://');
    }
  }
  if (text.length > MAX_URL_LENGTH) {
    throw new FetchPolicyError(`The URL is longer than ${String(MAX_URL_LENGTH)} characters.`);
  }

  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    throw new FetchPolicyError('That is not a valid URL.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new FetchPolicyError('Only http and https are allowed.');
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new FetchPolicyError('Do not put a username or password in the URL.');
  }

  parsed.hash = '';
  assertHostnameAllowed(parsed.hostname);

  return parsed;
}
