import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProductHarness as RealProductHarness } from './runner.ts';
class ProductHarness extends RealProductHarness {
  constructor(...args: ConstructorParameters<typeof RealProductHarness>) {
    args[6] = async () => {};
    super(...args);
  }
}
import { targetDigest, validateTarget, type Target, type Actor } from './target.ts';
const target: Target = {
  runId: 'synthetic-run',
  a: 'https://val-a.example.org',
  b: 'https://val-b.example.org',
  projectId: 'synthetic-project',
  branchId: 'synthetic-branch',
  database: 'synthetic_db',
  host: 'ep-synthetic.neon.tech',
  bundleSha256: 'a'.repeat(64),
  actors: Object.fromEntries(
    ['O', 'O2', 'C', 'X', 'T'].map((a, i) => [
      a,
      `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    ]),
  ) as Record<Actor, string>,
};
const creds = Object.fromEntries(
  ['O', 'O2', 'C', 'X', 'T'].map((a) => [
    a,
    { clientId: 'synthetic-' + a, clientSecret: 'test-only-not-a-real-token' },
  ]),
) as Record<Actor, { clientId: string; clientSecret: string }>;
test('harness reserves before dispatch, preserves sanitized evidence and never retries an uncertain write', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'is488-harness-'));
  try {
    const file = join(dir, 'audit.jsonl');
    let calls = 0;
    const h = new ProductHarness(
      target,
      creds,
      file,
      { runId: target.runId, targetSha256: targetDigest(target) },
      async () => {
        calls++;
        assert.ok(readFileSync(file, 'utf8').includes('dispatch'));
        throw new Error('lost HTTP');
      },
    );
    await assert.rejects(h.request('O', 'A', 'POST', '/api/projects', { title: 'synthetic' }, 201));
    await assert.rejects(h.request('O', 'A', 'POST', '/api/projects', {}, 201));
    assert.equal(calls, 1);
    assert.ok(h.summary().stopped);
    assert.ok(!readFileSync(file, 'utf8').includes('test-only-not-a-real-token'));
  } finally {
    rmSync(dir, { recursive: true });
  }
});
test('harness rejects exhaustion, bypass routes and unapproved target with zero transport', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'is488-harness-'));
  try {
    let calls = 0;
    const h = new ProductHarness(
      target,
      creds,
      join(dir, 'audit'),
      { runId: target.runId, targetSha256: targetDigest(target) },
      async () => {
        calls++;
        throw new Error('unexpected transport');
      },
    );
    assert.throws(() => h.reserve(96, 1));
    await assert.rejects(
      h.request('O', 'A', 'GET', 'https://other.example.org/api/projects', undefined, 200),
    );
    assert.equal(calls, 0);
    assert.throws(() => validateTarget({ ...target, a: 'https://public.workers.dev' }));
    assert.throws(
      () =>
        new ProductHarness(target, creds, join(dir, 'audit'), {
          runId: target.runId,
          targetSha256: 'wrong',
        }),
    );
  } finally {
    rmSync(dir, { recursive: true });
  }
});
import { runMinimal } from './runner.ts';
test('minimal product run checks isolated A/B reads, assignment-only access and conditional removals within budget', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'is488-harness-'));
  try {
    const p1 = '11111111-1111-4111-8111-111111111111',
      p2 = '22222222-2222-4222-8222-222222222222',
      p3 = '33333333-3333-4333-8333-333333333333',
      m1 = '44444444-4444-4444-8444-444444444444',
      m2 = '55555555-5555-4555-8555-555555555555',
      ownerMembership = '66666666-6666-4666-8666-666666666666',
      now = '2026-10-26T00:00:00.000Z';
    const project = (id: string, owner = target.actors.O) => ({
      id,
      creatorId: owner,
      createdAt: now,
    });
    const responses: [number, unknown][] = [
      [201, project(p1)],
      [201, project(p2)],
      [201, project(p3, target.actors.O2)],
      [200, project(p1)],
      [404, {}],
      [404, {}],
      [404, {}],
      [404, {}],
      [200, [project(p1), project(p2)]],
      [200, project(p1)],
      [403, {}],
      [201, { id: m1 }],
      [200, project(p1)],
      [400, {}],
      [400, {}],
      [200, [{ id: ownerMembership, role: 'owner', userId: target.actors.O }]],
      [422, {}],
      [200, { removedAt: now, updatedAt: now }],
      [404, {}],
      [404, {}],
      [404, {}],
      [200, []],
      [201, { id: m2 }],
      [404, {}],
      [200, project(p1)],
    ];
    let n = 0;
    const transport: typeof fetch = async (input) => {
      const url = new URL(String(input));
      const response = responses[n++];
      assert.ok(response);
      return Response.json(response[1], {
        status: response[0],
        headers: {
          'X-Validation-Deployment': url.hostname.includes('val-a') ? 'A' : 'B',
          'cache-control': 'private, no-store',
        },
      });
    };
    const h = new ProductHarness(
      target,
      creds,
      join(dir, 'audit'),
      { runId: target.runId, targetSha256: targetDigest(target) },
      transport,
    );
    let assigned = false;
    const result = await runMinimal(h, target, {
      observeOwner: async (id) => id === p1,
      assignTeacher: async (id, teacher) => {
        assert.equal(id, p1);
        assert.equal(teacher, target.actors.T);
        assigned = true;
      },
    });
    assert.ok(assigned);
    assert.equal(n, 25);
    assert.ok(result.requestsReserved <= 95 && result.statementsReserved <= 1200);
    assert.equal(result.stopped, false);
    assert.ok(readFileSync(join(dir, 'audit'), 'utf8').includes('operator_dispatch'));
  } finally {
    rmSync(dir, { recursive: true });
  }
});
test('harness rejects concurrent dispatch and collects the already dispatched peer', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'is488-harness-'));
  try {
    let release: (r: Response) => void = () => {};
    const pending = new Promise<Response>((r) => {
      release = r;
    });
    let calls = 0;
    let transportStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      transportStarted = resolve;
    });
    const h = new ProductHarness(
      target,
      creds,
      join(dir, 'audit'),
      { runId: target.runId, targetSha256: targetDigest(target) },
      async () => {
        calls++;
        transportStarted();
        return pending;
      },
    );
    const first = h.request('O', 'A', 'GET', '/api/health', undefined, 200);
    await started;
    await assert.rejects(h.request('O', 'A', 'GET', '/api/health', undefined, 200));
    assert.equal(calls, 1);
    release(
      Response.json(
        { ok: true },
        { headers: { 'X-Validation-Deployment': 'A', 'cache-control': 'private, no-store' } },
      ),
    );
    await first;
    assert.equal(h.summary().stopped, true);
  } finally {
    rmSync(dir, { recursive: true });
  }
});
test('harness preserves successful response IDs when close is unconfirmed and stops new effects', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'is488-harness-'));
  try {
    const file = join(dir, 'audit');
    const id = '11111111-1111-4111-8111-111111111111';
    let calls = 0;
    const h = new ProductHarness(
      target,
      creds,
      file,
      { runId: target.runId, targetSha256: targetDigest(target) },
      async () => {
        calls++;
        return Response.json(
          { id },
          {
            status: 201,
            headers: {
              'X-Validation-Deployment': 'A',
              'X-Persistence-Close': 'unconfirmed',
              'cache-control': 'private, no-store',
            },
          },
        );
      },
    );
    await assert.rejects(h.request('O', 'A', 'POST', '/api/projects', {}, 201));
    await assert.rejects(h.request('O', 'A', 'POST', '/api/projects', {}, 201));
    assert.equal(calls, 1);
    const events = readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    assert.ok(
      events.some(
        (e) =>
          e.event === 'observed' &&
          e.status === 201 &&
          e.ids.id === id &&
          e.closeConfirmed === false,
      ),
    );
    assert.ok(events.some((e) => e.event === 'stopped_after_response'));
  } finally {
    rmSync(dir, { recursive: true });
  }
});
test('harness response deadline includes stalled body and does not allow subsequent writes', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'is488-harness-'));
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const h = new ProductHarness(
      target,
      creds,
      join(dir, 'audit'),
      { runId: target.runId, targetSha256: targetDigest(target) },
      async () =>
        new Response(new ReadableStream({ start() {} }), {
          headers: { 'X-Validation-Deployment': 'A', 'cache-control': 'no-store' },
        }),
    );
    const work = h.request('O', 'A', 'GET', '/api/health', undefined, 200);
    await Promise.resolve();
    await Promise.resolve();
    t.mock.timers.tick(12001);
    await assert.rejects(work);
    assert.equal(h.summary().stopped, true);
    await assert.rejects(h.request('O', 'A', 'POST', '/api/projects', {}, 201));
  } finally {
    t.mock.timers.reset();
    rmSync(dir, { recursive: true });
  }
});
test('harness cannot resume an existing run artifact or silently repeat writes after restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'is488-harness-'));
  try {
    const file = join(dir, 'audit');
    new ProductHarness(target, creds, file, {
      runId: target.runId,
      targetSha256: targetDigest(target),
    });
    assert.throws(
      () =>
        new ProductHarness(target, creds, file, {
          runId: target.runId,
          targetSha256: targetDigest(target),
        }),
      /new_run_evidence_required/,
    );
    assert.ok(readFileSync(file, 'utf8').includes('run_prepared'));
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('HTTP failures retain status before JSON, body and header checks without leaking payloads or retrying', async (t) => {
  const id = '11111111-1111-4111-8111-111111111111';
  const cases = [
    {
      name: '403 non-JSON response',
      status: 403,
      reason: 'invalid_response_json',
      response: () =>
        new Response('<html>secret-body-value</html>', {
          status: 403,
          headers: { 'set-cookie': 'secret-cookie-value' },
        }),
      ids: false,
    },
    {
      name: '403 JSON rejection',
      status: 403,
      reason: 'unexpected_status',
      response: () => Response.json({ error: 'secret-body-value' }, { status: 403 }),
      ids: false,
    },
    {
      name: '201 wrong deployment',
      status: 201,
      reason: 'unexpected_deployment',
      response: () =>
        Response.json(
          { id, secret: 'secret-body-value' },
          {
            status: 201,
            headers: {
              'X-Validation-Deployment': 'secret-header-value',
              'cache-control': 'no-store',
            },
          },
        ),
      ids: true,
    },
    {
      name: '201 missing cache policy',
      status: 201,
      reason: 'missing_no_store',
      response: () =>
        Response.json({ id }, { status: 201, headers: { 'X-Validation-Deployment': 'A' } }),
      ids: true,
    },
    {
      name: '201 malformed JSON',
      status: 201,
      reason: 'invalid_response_json',
      response: () => new Response('{secret-body-value', { status: 201 }),
      ids: false,
    },
    {
      name: '201 failed body stream',
      status: 201,
      reason: 'response_body_incomplete',
      response: () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error('secret-body-value'));
            },
          }),
          { status: 201 },
        ),
      ids: false,
    },
    {
      name: '201 excessive declared length',
      status: 201,
      reason: 'response_too_large',
      response: () =>
        new Response('secret-body-value', { status: 201, headers: { 'content-length': '65537' } }),
      ids: false,
    },
  ];
  for (const scenario of cases)
    await t.test(scenario.name, async () => {
      const dir = mkdtempSync(join(tmpdir(), 'is488-harness-http-'));
      try {
        const file = join(dir, 'audit');
        let calls = 0;
        const h = new ProductHarness(
          target,
          creds,
          file,
          { runId: target.runId, targetSha256: targetDigest(target) },
          async () => {
            calls++;
            return scenario.response();
          },
        );
        await assert.rejects(h.request('O', 'A', 'POST', '/api/projects', {}, 201));
        await assert.rejects(h.request('O', 'A', 'POST', '/api/projects', {}, 201));
        assert.equal(calls, 1);
        const text = readFileSync(file, 'utf8');
        const events = text
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line));
        const headersIndex = events.findIndex((e) => e.event === 'response_headers');
        const stoppedIndex = events.findIndex((e) => e.event.startsWith('stopped_'));
        assert.ok(headersIndex > 0 && stoppedIndex > headersIndex);
        assert.equal(events[headersIndex].status, scenario.status);
        const stopped = events[stoppedIndex];
        assert.equal(stopped.status, scenario.status);
        assert.equal(stopped.reason, scenario.reason);
        assert.equal(stopped.httpObservation, 'status_received');
        assert.equal(stopped.writeOutcome, 'unconfirmed');
        assert.equal(
          events.some((e) => e.event === 'stopped_unknown_or_failed'),
          false,
        );
        if (scenario.ids) assert.ok(events.some((e) => e.event === 'observed' && e.ids.id === id));
        for (const secret of [
          'secret-body-value',
          'secret-cookie-value',
          'secret-header-value',
          'test-only-not-a-real-token',
        ])
          assert.ok(!text.includes(secret));
        assert.ok(h.summary().stopped);
      } finally {
        rmSync(dir, { recursive: true });
      }
    });
});

test('transport failure without headers stays distinct from known HTTP failure', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'is488-harness-transport-'));
  try {
    const file = join(dir, 'audit');
    const h = new ProductHarness(
      target,
      creds,
      file,
      { runId: target.runId, targetSha256: targetDigest(target) },
      async () => {
        throw new Error('secret-transport-value');
      },
    );
    await assert.rejects(h.request('O', 'A', 'POST', '/api/projects', {}, 201));
    const text = readFileSync(file, 'utf8');
    const events = text
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(
      events.some((e) => e.event === 'response_headers'),
      false,
    );
    const stopped = events.find((e) => e.event === 'stopped_unknown_or_failed');
    assert.equal(stopped.httpObservation, 'not_received');
    assert.equal(stopped.writeOutcome, 'unconfirmed');
    assert.equal('status' in stopped, false);
    assert.ok(!text.includes('secret-transport-value'));
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('explicit accumulated run budget retains prior counters and rejects exceeding 160/1600', () => {
  const dir = mkdtempSync(join(tmpdir(), 'is488-budget-'));
  try {
    const h = new ProductHarness(
      target,
      creds,
      join(dir, 'audit'),
      { runId: target.runId, targetSha256: targetDigest(target) },
      fetch,
      {
        requests: 100,
        statements: 1300,
        requestLimit: 160,
        statementLimit: 1600,
        startedAt: Date.now(),
        durationMs: 3600000,
      },
    );
    assert.equal(h.summary().requestsReserved, 100);
    assert.equal(h.summary().statementsReserved, 1300);
    h.reserve(60, 300);
    assert.throws(() => h.reserve(1, 0));
    assert.throws(
      () =>
        new ProductHarness(
          target,
          creds,
          join(dir, 'invalid'),
          { runId: target.runId, targetSha256: targetDigest(target) },
          fetch,
          {
            requests: 61,
            statements: 390,
            requestLimit: 160,
            statementLimit: 1600,
            startedAt: Date.now() - 3600001,
            durationMs: 3600000,
          },
        ),
    );
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('diagnostic creation is reused by functional journey without repeating initial POST', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'is488-seed-'));
  try {
    const now = '2026-10-26T00:00:00.000Z';
    const seed = {
      id: '11111111-1111-4111-8111-111111111111',
      creatorId: target.actors.O,
      createdAt: now,
    };
    let posts = 0;
    let observed = 0;
    const h = new ProductHarness(
      target,
      creds,
      join(dir, 'audit'),
      { runId: target.runId, targetSha256: targetDigest(target) },
      async (_url, options) => {
        if (options?.method !== 'POST') throw new Error('intentional end of bounded seed test');
        posts++;
        return Response.json(
          {
            id:
              posts === 1
                ? '22222222-2222-4222-8222-222222222222'
                : '33333333-3333-4333-8333-333333333333',
            creatorId: posts === 1 ? target.actors.O : target.actors.O2,
            createdAt: now,
          },
          { status: 201, headers: { 'X-Validation-Deployment': 'A', 'cache-control': 'no-store' } },
        );
      },
    );
    await assert.rejects(
      runMinimal(
        h,
        target,
        {
          observeOwner: async (id) => {
            assert.equal(id, seed.id);
            observed++;
            return true;
          },
          assignTeacher: async () => {
            throw new Error('not reached');
          },
        },
        seed,
      ),
    );
    assert.equal(observed, 1);
    assert.equal(posts, 2);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('DNS gate precedes HTTP and never retries a POST after transport ENOTFOUND', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'is488-dns-gate-'));
  let lookups = 0;
  let calls = 0;
  try {
    const { createDnsReadiness } = await import('./dns-readiness.ts');
    const gate = createDnsReadiness(() => {}, {
      lookup: async () => {
        lookups++;
        return [{ address: '192.0.2.1', family: 4 }];
      },
    });
    const h = new RealProductHarness(
      target,
      creds,
      join(dir, 'audit'),
      { runId: target.runId, targetSha256: targetDigest(target) },
      async () => {
        calls++;
        assert.equal(lookups, 1);
        throw Object.assign(new Error('private transport detail'), { code: 'ENOTFOUND' });
      },
      undefined,
      gate,
    );
    await assert.rejects(h.request('O', 'A', 'POST', '/api/projects', {}, 201));
    await assert.rejects(h.request('O', 'A', 'POST', '/api/projects', {}, 201));
    assert.equal(calls, 1);
    assert.equal(lookups, 1);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('unready DNS stops harness with zero HTTP dispatch and no subsequent effects', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'is488-dns-stop-'));
  let calls = 0;
  let lookups = 0;
  try {
    const { createDnsReadiness } = await import('./dns-readiness.ts');
    const file = join(dir, 'audit');
    const gate = createDnsReadiness(() => {}, {
      maxAttempts: 2,
      intervalMs: 0,
      lookup: async () => {
        lookups++;
        throw Object.assign(new Error('private resolver detail'), { code: 'ENOTFOUND' });
      },
    });
    const h = new RealProductHarness(
      target,
      creds,
      file,
      { runId: target.runId, targetSha256: targetDigest(target) },
      async () => {
        calls++;
        throw new Error('must not dispatch');
      },
      undefined,
      gate,
    );
    await assert.rejects(h.request('O', 'A', 'POST', '/api/projects', {}, 201));
    await assert.rejects(h.request('O', 'A', 'POST', '/api/projects', {}, 201));
    assert.equal(calls, 0);
    assert.equal(lookups, 2);
    const text = readFileSync(file, 'utf8');
    assert.ok(!text.includes('private resolver detail'));
    assert.ok(!text.split('\n').some((line) => line && JSON.parse(line).event === 'dispatch'));
  } finally {
    rmSync(dir, { recursive: true });
  }
});
