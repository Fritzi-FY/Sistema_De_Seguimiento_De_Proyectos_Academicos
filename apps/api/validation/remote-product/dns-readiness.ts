import { lookup as systemLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
export type DnsEvent = {
  event: string;
  hostname: string;
  attempt?: number;
  code?: string;
  addressCount?: number;
  underlyingLookupCancelled?: boolean;
};
export interface DnsOptions {
  timeoutMs?: number;
  attemptTimeoutMs?: number;
  intervalMs?: number;
  maxAttempts?: number;
  lookup?: (hostname: string) => Promise<readonly { address: string; family: number }[]>;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
}
export function verifyCustomDomainResponse(
  value: unknown,
  expected: { hostname: string; service: string; zoneId: string; zoneName: string },
) {
  if (!value || typeof value !== 'object') throw new Error('custom_domain_response_missing');
  const v = value as Record<string, unknown>;
  if (
    typeof v.id !== 'string' ||
    !v.id ||
    v.hostname !== expected.hostname ||
    v.service !== expected.service ||
    v.zone_id !== expected.zoneId ||
    v.zone_name !== expected.zoneName ||
    v.enabled !== true
  )
    throw new Error('custom_domain_response_mismatch');
  return {
    id: v.id,
    hostname: expected.hostname,
    service: expected.service,
    zoneId: expected.zoneId,
    zoneName: expected.zoneName,
    enabled: true as const,
  };
}
export function createDnsReadiness(record: (event: DnsEvent) => void, options: DnsOptions = {}) {
  const timeout = options.timeoutMs ?? 30000;
  const attemptTimeout = options.attemptTimeoutMs ?? 3000;
  const interval = options.intervalMs ?? 1000;
  const maxAttempts = options.maxAttempts ?? 10;
  if (
    ![timeout, attemptTimeout, interval, maxAttempts].every(Number.isInteger) ||
    timeout < 1 ||
    timeout > 30000 ||
    attemptTimeout < 1 ||
    attemptTimeout > 3000 ||
    interval < 0 ||
    interval > 1000 ||
    maxAttempts < 1 ||
    maxAttempts > 10
  )
    throw new Error('invalid_dns_bounds');
  const lookup =
    options.lookup ??
    (async (hostname: string) => systemLookup(hostname, { all: true, verbatim: true }));
  const now = options.now ?? Date.now;
  const wait =
    options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const ready = new Map<string, number>();
  return async (hostname: string) => {
    if (
      hostname.length > 253 ||
      isIP(hostname) ||
      !hostname.includes('.') ||
      hostname.split('.').some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
    )
      throw new Error('invalid_dns_hostname');
    if ((ready.get(hostname) ?? 0) > now()) return;
    const deadline = now() + timeout;
    for (let attempt = 1; attempt <= maxAttempts && now() < deadline; attempt++) {
      record({ event: 'dns_lookup_dispatch', hostname, attempt });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const addresses = await Promise.race([
          lookup(hostname),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('dns_lookup_timeout')),
              Math.min(attemptTimeout, deadline - now()),
            );
          }),
        ]);
        if (now() >= deadline) throw new Error('dns_lookup_timeout');
        if (
          !addresses.length ||
          addresses.some((a) => isIP(a.address) !== a.family || ![4, 6].includes(a.family))
        )
          throw new Error('invalid_dns_addresses');
        record({ event: 'dns_ready', hostname, attempt, addressCount: addresses.length });
        ready.set(hostname, now() + 30000);
        return;
      } catch (error) {
        const e = error as { code?: string; message?: string };
        if (e.message === 'dns_lookup_timeout') {
          record({
            event: 'dns_lookup_timeout',
            hostname,
            attempt,
            underlyingLookupCancelled: false,
          });
          throw new Error('dns_readiness_timeout');
        }
        const code = ['ENOTFOUND', 'EAI_AGAIN', 'ENODATA'].includes(e.code ?? '')
          ? e.code
          : 'DNS_LOOKUP_FAILED';
        record({ event: 'dns_not_ready', hostname, attempt, code });
        if (code === 'DNS_LOOKUP_FAILED') throw new Error('dns_readiness_failed');
      } finally {
        if (timer) clearTimeout(timer);
      }
      if (attempt < maxAttempts && now() < deadline)
        await wait(Math.min(interval, deadline - now()));
    }
    record({ event: 'dns_readiness_exhausted', hostname });
    throw new Error('dns_readiness_exhausted');
  };
}

export function createDnsGatedTransport(
  hostnames: readonly string[],
  record: (event: DnsEvent) => void,
  transport: typeof fetch = fetch,
  options: DnsOptions = {},
): typeof fetch {
  const ready = createDnsReadiness(record, options);
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      !hostnames.includes(url.hostname)
    )
      throw new Error('dns_transport_target_rejected');
    await ready(url.hostname);
    return transport(input, init);
  };
}
