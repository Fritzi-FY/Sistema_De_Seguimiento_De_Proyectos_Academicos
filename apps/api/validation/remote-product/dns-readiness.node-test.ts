import { test } from 'node:test';
import { createDnsGatedTransport } from './dns-readiness.ts';
import assert from 'node:assert/strict';
import { createDnsReadiness, verifyCustomDomainResponse, type DnsEvent } from './dns-readiness.ts';
const host = 'epic002-val-a.quiosco-ya.store';
test('Custom Domain validates returned hostname/service/zone/enabled and records only approved fields', () => {
  const expected = {
    hostname: host,
    service: 'is488-epic002-val-a',
    zoneId: 'zone-id',
    zoneName: 'quiosco-ya.store',
  };
  const returned = {
    id: 'domain-id',
    hostname: host,
    service: expected.service,
    zone_id: expected.zoneId,
    zone_name: expected.zoneName,
    enabled: true,
    secret: 'never copy',
  };
  assert.deepEqual(verifyCustomDomainResponse(returned, expected), {
    id: 'domain-id',
    ...expected,
    enabled: true,
  });
  for (const bad of [
    { ...returned, hostname: 'typo.quiosco-ya.store' },
    { ...returned, service: 'different-worker' },
    { ...returned, zone_id: 'other-zone' },
    { ...returned, zone_name: 'other.store' },
    { ...returned, enabled: false },
    { id: 'domain-id' },
    undefined,
  ])
    assert.throws(() => verifyCustomDomainResponse(bad, expected));
});
test('DNS retries resolution only within bounds and caches successful lookup briefly', async () => {
  let now = 0;
  let calls = 0;
  const events: DnsEvent[] = [];
  const gate = createDnsReadiness((e) => events.push(e), {
    now: () => now,
    wait: async (ms) => {
      now += ms;
    },
    intervalMs: 10,
    maxAttempts: 3,
    lookup: async () => {
      calls++;
      if (calls < 3)
        throw Object.assign(new Error('secret resolver message'), { code: 'ENOTFOUND' });
      return [{ address: '192.0.2.1', family: 4 }];
    },
  });
  await gate(host);
  await gate(host);
  assert.equal(calls, 3);
  assert.equal(now, 20);
  assert.equal(events.at(-1)?.event, 'dns_ready');
  assert.ok(!JSON.stringify(events).includes('secret resolver message'));
});
test('DNS overall deadline stops retries and does not attribute failure to propagation', async () => {
  let now = 0;
  let calls = 0;
  const events: DnsEvent[] = [];
  const gate = createDnsReadiness((e) => events.push(e), {
    timeoutMs: 40,
    intervalMs: 20,
    now: () => now,
    wait: async (ms) => {
      now += ms;
    },
    lookup: async () => {
      calls++;
      throw Object.assign(new Error('resolver detail'), { code: 'EAI_AGAIN' });
    },
  });
  await assert.rejects(gate(host), /dns_readiness_exhausted/);
  assert.equal(calls, 2);
  assert.equal(now, 40);
  assert.equal(events.at(-1)?.event, 'dns_readiness_exhausted');
});
test('hung lookup has bounded wait and no parallel retry or cancellation claim', async () => {
  let calls = 0;
  const events: DnsEvent[] = [];
  const gate = createDnsReadiness((e) => events.push(e), {
    attemptTimeoutMs: 5,
    lookup: async () => {
      calls++;
      return new Promise(() => {});
    },
  });
  await assert.rejects(gate(host), /dns_readiness_timeout/);
  assert.equal(calls, 1);
  assert.equal(events.at(-1)?.underlyingLookupCancelled, false);
});
test('invalid host, invalid bounds and non-address lookup results fail closed', async () => {
  let calls = 0;
  const gate = createDnsReadiness(() => {}, {
    lookup: async () => {
      calls++;
      return [];
    },
  });
  await assert.rejects(gate('127.0.0.1'));
  await assert.rejects(gate('bad..example.org'));
  assert.equal(calls, 0);
  await assert.rejects(gate(host), /dns_readiness_failed/);
  assert.throws(() => createDnsReadiness(() => {}, { timeoutMs: 60000 }));
  assert.throws(() => createDnsReadiness(() => {}, { maxAttempts: 11 }));
});

test('unauthenticated diagnostic transport is DNS gated as well, without HTTP retry', async () => {
  let dns = 0;
  let http = 0;
  const transport = createDnsGatedTransport(
    [host],
    () => {},
    async () => {
      http++;
      assert.equal(dns, 1);
      return new Response(null, { status: 403 });
    },
    {
      lookup: async () => {
        dns++;
        return [{ address: '192.0.2.1', family: 4 }];
      },
    },
  );
  const response = await transport('https://' + host + '/api/health');
  assert.equal(response.status, 403);
  assert.equal(http, 1);
  await assert.rejects(transport('https://other.example.org/api/health'));
  assert.equal(http, 1);
});
test('DNS diagnostic exhaustion prevents both unauthenticated GET and creation POST', async () => {
  let http = 0;
  const transport = createDnsGatedTransport(
    [host],
    () => {},
    async () => {
      http++;
      return new Response();
    },
    {
      maxAttempts: 1,
      lookup: async () => {
        throw Object.assign(new Error('not logged'), { code: 'ENOTFOUND' });
      },
    },
  );
  await assert.rejects(transport('https://' + host + '/api/health'));
  await assert.rejects(transport('https://' + host + '/api/projects', { method: 'POST' }));
  assert.equal(http, 0);
});
