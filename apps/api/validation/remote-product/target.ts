import { createHash } from 'node:crypto';
export type Actor = 'O' | 'O2' | 'C' | 'X' | 'T';
export interface Target {
  runId: string;
  a: string;
  b: string;
  projectId: string;
  branchId: string;
  database: string;
  host: string;
  bundleSha256: string;
  actors: Record<Actor, string>;
}
export function targetDigest(t: Target) {
  return createHash('sha256').update(JSON.stringify(t)).digest('hex');
}
export function validateTarget(t: Target) {
  if (
    !t ||
    !/^[a-z0-9-]{3,64}$/.test(t.runId) ||
    ![t.projectId, t.branchId, t.database, t.host].every(
      (s) => typeof s === 'string' && s.length > 2 && !/pending|placeholder|replace/i.test(s),
    ) ||
    !/^[a-f0-9]{64}$/.test(t.bundleSha256)
  )
    throw new Error('target_not_approved');
  const a = new URL(t.a),
    b = new URL(t.b);
  for (const u of [a, b])
    if (
      u.protocol !== 'https:' ||
      u.username ||
      u.password ||
      u.pathname !== '/' ||
      u.search ||
      u.hash ||
      u.port ||
      u.hostname.endsWith('.workers.dev') ||
      u.hostname.endsWith('.invalid') ||
      u.hostname.includes('localhost')
    )
      throw new Error('private_target_required');
  if (
    a.origin === b.origin ||
    a.hostname.split('.').slice(1).join('.') !== b.hostname.split('.').slice(1).join('.')
  )
    throw new Error('distinct_deployments_required');
  if (
    Object.keys(t.actors).sort().join() !== 'C,O,O2,T,X' ||
    new Set(Object.values(t.actors)).size !== 5 ||
    Object.values(t.actors).some((v) => !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v))
  )
    throw new Error('synthetic_actors_required');
  return t;
}
