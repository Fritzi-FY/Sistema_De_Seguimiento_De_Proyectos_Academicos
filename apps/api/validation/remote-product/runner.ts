import { createDnsReadiness } from './dns-readiness.ts';
import { openSync, writeSync, fsyncSync, closeSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { targetDigest, validateTarget, type Target, type Actor } from './target.ts';
export interface Credentials {
  clientId: string;
  clientSecret: string;
}
export interface ExecutionBudget {
  requests: number;
  statements: number;
  requestLimit: 95 | 160;
  statementLimit: 1200 | 1600;
  startedAt: number;
  durationMs: 1800000 | 3600000;
}
export class ProductHarness {
  private requests = 36;
  private statements = 500;
  private count = 0;
  private stopped = false;
  private inFlight = false;
  private started = Date.now();
  private requestLimit = 95;
  private statementLimit = 1200;
  private durationMs = 1800000;
  private readonly target: Target;
  private readonly credentials: Record<Actor, Credentials>;
  private readonly auditFile: string;
  private readonly transport: typeof fetch;
  private readonly dnsReadiness: (hostname: string) => Promise<void>;
  constructor(
    target: Target,
    credentials: Record<Actor, Credentials>,
    auditFile: string,
    permission: { runId: string; targetSha256: string },
    transport: typeof fetch = fetch,
    budget?: ExecutionBudget,
    dnsReadiness?: (hostname: string) => Promise<void>,
  ) {
    this.target = target;
    this.credentials = credentials;
    this.auditFile = auditFile;
    this.transport = transport;
    this.dnsReadiness = dnsReadiness ?? createDnsReadiness((event) => this.record(event));
    if (budget) {
      if (
        ![budget.requests, budget.statements, budget.startedAt].every(Number.isInteger) ||
        budget.requests < 0 ||
        budget.statements < 0 ||
        budget.startedAt > Date.now() ||
        ![95, 160].includes(budget.requestLimit) ||
        ![1200, 1600].includes(budget.statementLimit) ||
        ![1800000, 3600000].includes(budget.durationMs) ||
        budget.requests > budget.requestLimit ||
        budget.statements > budget.statementLimit ||
        Date.now() - budget.startedAt >= budget.durationMs
      )
        throw new Error('invalid_execution_budget');
      this.requests = budget.requests;
      this.statements = budget.statements;
      this.requestLimit = budget.requestLimit;
      this.statementLimit = budget.statementLimit;
      this.started = budget.startedAt;
      this.durationMs = budget.durationMs;
    }
    validateTarget(target);
    if (permission.runId !== target.runId || permission.targetSha256 !== targetDigest(target))
      throw new Error('execution_not_authorized');
    for (const actor of ['O', 'O2', 'C', 'X', 'T'] as const)
      if (!credentials[actor]?.clientId || !credentials[actor]?.clientSecret)
        throw new Error('credentials_required');
    let fd: number | undefined;
    try {
      fd = openSync(auditFile, 'wx', 0o600);
      const plan = Buffer.from(
        JSON.stringify({
          event: 'run_prepared',
          runId: target.runId,
          targetSha256: targetDigest(target),
          requestsReserved: this.requests,
          statementsReserved: this.statements,
          requestLimit: this.requestLimit,
          statementLimit: this.statementLimit,
          startedAt: this.started,
          durationMs: this.durationMs,
        }) + '\n',
      );
      let offset = 0;
      while (offset < plan.length) {
        const n = writeSync(fd, plan, offset, plan.length - offset);
        if (!n) throw new Error('incomplete_plan_evidence');
        offset += n;
      }
      fsyncSync(fd);
    } catch {
      throw new Error('new_run_evidence_required');
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }
  private record(event: Record<string, unknown>) {
    const fd = openSync(this.auditFile, 'a', 0o600);
    try {
      const bytes = Buffer.from(JSON.stringify({ runId: this.target.runId, ...event }) + '\n');
      let offset = 0;
      while (offset < bytes.length) {
        const n = writeSync(fd, bytes, offset);
        if (!n) throw new Error('evidence_failed');
        offset += n;
      }
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }
  reserve(requests: number, statements: number) {
    if (
      this.stopped ||
      Date.now() - this.started >= this.durationMs ||
      !Number.isInteger(requests) ||
      !Number.isInteger(statements) ||
      requests < 0 ||
      statements < 0 ||
      this.requests + requests > this.requestLimit ||
      this.statements + statements > this.statementLimit
    ) {
      this.stopped = true;
      throw new Error('budget_or_state_rejected');
    }
    this.requests += requests;
    this.statements += statements;
  }
  async request(
    actor: Actor,
    deployment: 'A' | 'B',
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body: unknown,
    expected: number,
    statements = 42,
  ): Promise<unknown> {
    if (this.inFlight) {
      this.stopped = true;
      throw new Error('concurrent_dispatch_rejected');
    }
    if (
      !['O', 'O2', 'C', 'X', 'T'].includes(actor) ||
      !['A', 'B'].includes(deployment) ||
      !['GET', 'POST', 'DELETE'].includes(method)
    ) {
      this.stopped = true;
      throw new Error('request_rejected');
    }
    if (++this.count > 48) {
      this.stopped = true;
      throw new Error('product_request_limit');
    }
    const url = new URL(path, deployment === 'A' ? this.target.a : this.target.b),
      base = new URL(deployment === 'A' ? this.target.a : this.target.b);
    if (
      url.origin !== base.origin ||
      !/^\/api\/(health|projects(?:\/[a-f0-9-]+(?:\/members(?:\/[a-f0-9-]+)?)?)?)$/i.test(
        url.pathname,
      ) ||
      [...url.searchParams.keys()].some((k) => k !== 'membershipId')
    ) {
      this.stopped = true;
      throw new Error('route_rejected');
    }
    const minimum =
      method === 'GET'
        ? url.pathname === '/api/health'
          ? 0
          : url.pathname === '/api/projects'
            ? 42
            : 21
        : url.pathname === '/api/projects'
          ? 8
          : 28;
    if (statements < minimum) {
      this.stopped = true;
      throw new Error('insufficient_statement_reservation');
    }
    this.reserve(2, statements);
    this.inFlight = true;
    const attempt = randomUUID();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined,
      reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let observed = false;
    let responseStatus: number | undefined;
    let failureReason = 'dns_readiness';
    try {
      await this.dnsReadiness(url.hostname);
      this.reserve(0, 0);
      failureReason = 'transport_or_timeout';
      this.record({
        event: 'dispatch',
        attempt,
        actor,
        deployment,
        method,
        path: url.pathname,
        statementReserve: statements,
      });
      const collect = (async () => {
        const c = this.credentials[actor];
        const r = await this.transport(url, {
          method,
          signal: controller.signal,
          redirect: 'error',
          headers: {
            'CF-Access-Client-Id': c.clientId,
            'CF-Access-Client-Secret': c.clientSecret,
            'Content-Type': 'application/json',
            'X-Validation-Operation': attempt,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        responseStatus = r.status;
        this.record({
          event: 'response_headers',
          attempt,
          status: r.status,
          expectedStatus: expected,
          deploymentMatches: r.headers.get('X-Validation-Deployment') === deployment,
          cacheNoStore: r.headers.get('cache-control')?.includes('no-store') === true,
          persistenceCloseReported:
            r.headers.get('X-Persistence-Close') === 'unconfirmed'
              ? 'unconfirmed'
              : r.headers.get('X-Persistence-Close') === 'confirmed'
                ? 'confirmed'
                : 'not_reported',
        });
        failureReason = 'response_body_incomplete';
        if (Number(r.headers.get('content-length') ?? 0) > 65536) {
          failureReason = 'response_too_large';
          throw new Error('response_too_large');
        }
        const chunks: Uint8Array[] = [];
        let total = 0;
        reader = r.body?.getReader();
        if (reader)
          for (;;) {
            const p = await reader.read();
            if (p.done) break;
            total += p.value.length;
            if (total > 65536) {
              failureReason = 'response_too_large';
              throw new Error('response_too_large');
            }
            chunks.push(p.value);
          }
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const c of chunks) {
          bytes.set(c, offset);
          offset += c.length;
        }
        failureReason = 'invalid_response_json';
        const data: unknown = total
          ? JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
          : null;
        return {
          status: r.status,
          closeConfirmed: r.headers.get('X-Persistence-Close') !== 'unconfirmed',
          data,
          validationFailure:
            r.status !== expected
              ? 'unexpected_status'
              : r.headers.get('X-Validation-Deployment') !== deployment
                ? 'unexpected_deployment'
                : !r.headers.get('cache-control')?.includes('no-store')
                  ? 'missing_no_store'
                  : undefined,
        };
      })();
      const result = await Promise.race([
        collect,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            failureReason = 'http_deadline';
            controller.abort();
            reject(new Error('http_unknown'));
          }, 12000);
        }),
      ]);
      const ids: Record<string, string> = {};
      if (result.data && typeof result.data === 'object' && !Array.isArray(result.data))
        for (const key of ['id', 'projectId']) {
          const value = (result.data as Record<string, unknown>)[key];
          if (
            typeof value === 'string' &&
            /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value)
          )
            ids[key] = value;
        }
      this.record({
        event: 'observed',
        attempt,
        status: result.status,
        ids,
        closeConfirmed: result.closeConfirmed,
      });
      observed = true;
      if (result.validationFailure || !result.closeConfirmed) {
        failureReason = result.validationFailure ?? 'close_unconfirmed';
        throw new Error(failureReason);
      }
      return result.data;
    } catch {
      this.stopped = true;
      try {
        this.record({
          event: observed
            ? 'stopped_after_response'
            : responseStatus !== undefined
              ? 'stopped_after_headers'
              : 'stopped_unknown_or_failed',
          attempt,
          reason: failureReason,
          httpObservation: responseStatus === undefined ? 'not_received' : 'status_received',
          ...(responseStatus === undefined ? {} : { status: responseStatus }),
          writeOutcome: method === 'GET' ? 'not_applicable' : 'unconfirmed',
        });
      } catch {
        /* Existing dispatch evidence remains; no further effects. */
      }
      throw new Error('run_stopped_no_retry');
    } finally {
      this.inFlight = false;
      if (timer) clearTimeout(timer);
      void reader?.cancel().catch(() => {});
    }
  }
  async operator<T>(
    operation: 'observe' | 'assign',
    projectId: string,
    statements: number,
    work: () => Promise<T>,
  ): Promise<T> {
    if (this.inFlight) {
      this.stopped = true;
      throw new Error('concurrent_dispatch_rejected');
    }
    this.reserve(0, statements);
    this.inFlight = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      this.record({ event: 'operator_dispatch', operation, projectId });
      const result = await Promise.race([
        work(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('operator_unknown')), 12000);
        }),
      ]);
      this.record({ event: 'operator_observed', operation, projectId });
      return result;
    } catch {
      this.stopped = true;
      try {
        this.record({ event: 'operator_unknown', operation, projectId });
      } catch {
        /* Preserve the dispatch record and original uncertain result. */
      }
      throw new Error('operator_stopped_no_retry');
    } finally {
      this.inFlight = false;
      if (timer) clearTimeout(timer);
    }
  }
  stop() {
    this.stopped = true;
  }
  summary() {
    return {
      requestsReserved: this.requests,
      statementsReserved: this.statements,
      stopped: this.stopped,
      productRequests: this.count,
    };
  }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('response_contract');
  return value as Record<string, unknown>;
}
export async function runMinimal(
  h: ProductHarness,
  target: Target,
  operator: {
    observeOwner(projectId: string): Promise<boolean>;
    assignTeacher(projectId: string, teacherId: string): Promise<void>;
  },
  diagnosticProject?: unknown,
) {
  const uuid = (value: unknown) => {
    if (typeof value !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value))
      throw new Error('invalid_response_identity');
    return value;
  };
  const body = {
    title: 'Synthetic remote validation',
    courseCode: 'IS488',
    startDate: '2026-10-26T00:00:00.000Z',
    targetDate: '2026-12-31T00:00:00.000Z',
  };
  try {
    const p = object(
      diagnosticProject ?? (await h.request('O', 'A', 'POST', '/api/projects', body, 201, 8)),
    );
    const id = uuid(p.id);
    if (typeof p.createdAt !== 'string' || p.creatorId !== target.actors.O)
      throw new Error('creation_identity');
    if (!(await h.operator('observe', id, 30, () => operator.observeOwner(id))))
      throw new Error('owner_not_confirmed');
    const p2 = object(await h.request('O', 'A', 'POST', '/api/projects', body, 201, 8));
    const p3 = object(await h.request('O2', 'A', 'POST', '/api/projects', body, 201, 8));
    if (
      new Set([id, uuid(p2.id), uuid(p3.id)]).size !== 3 ||
      p2.creatorId !== target.actors.O ||
      p3.creatorId !== target.actors.O2
    )
      throw new Error('project_isolation');
    const read = object(
      await h.request('O', 'B', 'GET', '/api/projects/' + id, undefined, 200, 21),
    );
    if (read.id !== id || read.createdAt !== p.createdAt) throw new Error('durability_mismatch');
    await h.request('X', 'B', 'GET', '/api/projects/' + id, undefined, 404, 21);
    await h.request('T', 'B', 'GET', '/api/projects/' + id, undefined, 404, 21);
    for (const other of [p2, p3])
      await h.request('C', 'B', 'GET', '/api/projects/' + uuid(other.id), undefined, 404, 21);
    const ownerList = await h.request('O', 'B', 'GET', '/api/projects', undefined, 200);
    if (
      !Array.isArray(ownerList) ||
      ownerList.length !== 2 ||
      !ownerList.some((v) => object(v).id === id) ||
      !ownerList.some((v) => object(v).id === p2.id) ||
      ownerList.some((v) => object(v).id === p3.id)
    )
      throw new Error('list_isolation');
    await h.operator('assign', id, 20, () => operator.assignTeacher(id, target.actors.T));
    await h.request('T', 'B', 'GET', '/api/projects/' + id, undefined, 200, 21);
    const memberPath = '/api/projects/' + id + '/members',
      removePath = memberPath + '/' + target.actors.C;
    await h.request(
      'T',
      'B',
      'POST',
      memberPath,
      { userId: target.actors.C, role: 'collaborator' },
      403,
      28,
    );
    const m = object(
      await h.request(
        'O',
        'A',
        'POST',
        memberPath,
        { userId: target.actors.C, role: 'collaborator' },
        201,
        28,
      ),
    );
    const m1 = uuid(m.id);
    await h.request('C', 'B', 'GET', '/api/projects/' + id, undefined, 200, 21);
    await h.request('O', 'A', 'DELETE', removePath, undefined, 400, 28);
    await h.request('O', 'A', 'DELETE', removePath + '?membershipId=invalid', undefined, 400, 28);
    const members = await h.request('O', 'A', 'GET', memberPath, undefined, 200, 21);
    if (!Array.isArray(members)) throw new Error('member_contract');
    const owner = members
      .map(object)
      .find((m) => m.role === 'owner' && m.userId === target.actors.O);
    if (!owner) throw new Error('owner_identity');
    await h.request(
      'O',
      'A',
      'DELETE',
      memberPath + '/' + target.actors.O + '?membershipId=' + uuid(owner.id),
      undefined,
      422,
      28,
    );
    const removed = object(
      await h.request('O', 'A', 'DELETE', removePath + '?membershipId=' + m1, undefined, 200, 28),
    );
    if (!removed.removedAt || removed.removedAt !== removed.updatedAt)
      throw new Error('removal_timestamp');
    await h.request('O', 'A', 'DELETE', removePath + '?membershipId=' + m1, undefined, 404, 28);
    await h.request('C', 'B', 'GET', '/api/projects/' + id, undefined, 404, 21);
    await h.request('C', 'B', 'GET', memberPath, undefined, 404, 21);
    const list = await h.request('C', 'B', 'GET', '/api/projects', undefined, 200);
    if (!Array.isArray(list) || list.some((v) => object(v).id === id))
      throw new Error('revocation_failed');
    const m2 = object(
      await h.request(
        'O',
        'A',
        'POST',
        memberPath,
        { userId: target.actors.C, role: 'collaborator' },
        201,
        28,
      ),
    );
    if (uuid(m2.id) === m1) throw new Error('membership_identity');
    await h.request('O', 'A', 'DELETE', removePath + '?membershipId=' + m1, undefined, 404, 28);
    await h.request('C', 'B', 'GET', '/api/projects/' + id, undefined, 200, 21);
    return h.summary();
  } catch (error) {
    h.stop();
    throw error;
  }
}
