import { checkServerIdentity, type TLSSocket } from 'node:tls';
import { createHash, X509Certificate } from 'node:crypto';
import type { ClientConfig } from 'pg';
export interface RemoteProfile {
  kind: 'remote';
  neonProxy?: {
    host:
      | 'ep-icy-meadow-b4zhj5uj.c-6.us-east-2.aws.neon.tech'
      | 'ep-billowing-silence-b4pbe6g5.c-6.us-east-2.aws.neon.tech';
  };
  approvalId: string;
  projectId: string;
  branchId: string;
  host: string;
  port: number;
  database: string;
  migrator: string;
  runtime: string;
  versions: readonly number[];
  ca: string;
  caSha256: string;
}
export function prepareConnection(
  c: ClientConfig,
  runtime: string,
  p?: RemoteProfile,
): ClientConfig {
  if (
    !c.host ||
    !Number.isInteger(c.port) ||
    Number(c.port) < 1 ||
    Number(c.port) > 65535 ||
    !c.database ||
    !c.user ||
    c.connectionString ||
    c.stream ||
    c.ssl
  )
    throw new Error('direct_connection_required');
  if (!p) {
    if (!['127.0.0.1', '::1', 'localhost'].includes(String(c.host)))
      throw new Error('direct_local_connection_required');
    return c;
  }
  if (
    p.kind !== 'remote' ||
    (p.neonProxy !== undefined &&
      (![
        'ep-icy-meadow-b4zhj5uj.c-6.us-east-2.aws.neon.tech',
        'ep-billowing-silence-b4pbe6g5.c-6.us-east-2.aws.neon.tech',
      ].includes(p.neonProxy.host) ||
        p.neonProxy.host !== p.host ||
        p.database !== 'is488_epic002_validation')) ||
    ![p.approvalId, p.projectId, p.branchId].every(
      (v) => typeof v === 'string' && v.length >= 3 && v.length <= 128,
    ) ||
    p.host !== c.host ||
    p.port !== c.port ||
    p.database !== c.database ||
    p.migrator !== c.user ||
    p.runtime !== runtime ||
    !/^ep-[a-z0-9.-]+\.neon\.tech$/.test(p.host) ||
    p.host.includes('-pooler') ||
    p.port !== 5432 ||
    !p.versions.length ||
    !p.versions.every((v) => Number.isInteger(v) && v >= 170000 && v < 190000) ||
    createHash('sha256').update(p.ca).digest('hex') !== p.caSha256
  )
    throw new Error('remote_profile_rejected');
  const ca = new X509Certificate(p.ca);
  if (!ca.ca || Date.parse(ca.validFrom) > Date.now() || Date.parse(ca.validTo) <= Date.now())
    throw new Error('remote_ca_rejected');
  return { ...c, ssl: { ca: p.ca, servername: p.host, rejectUnauthorized: true } };
}
export interface ExternalTlsEvidence {
  host: string;
  protocol: string;
  authorized: true;
  fingerprint256: string;
}
export function verifyExternalTls(socket: TLSSocket, host: string): ExternalTlsEvidence {
  if (
    !socket ||
    socket.encrypted !== true ||
    socket.authorized !== true ||
    socket.authorizationError
  )
    throw new Error('external_tls_unauthorized');
  const protocol = socket.getProtocol();
  if (protocol !== 'TLSv1.2' && protocol !== 'TLSv1.3')
    throw new Error('external_tls_protocol_rejected');
  const certificate = socket.getPeerCertificate(true);
  if (
    !certificate?.raw?.length ||
    !certificate.fingerprint256 ||
    checkServerIdentity(host, certificate)
  )
    throw new Error('external_tls_certificate_rejected');
  return { host, protocol, authorized: true, fingerprint256: certificate.fingerprint256 };
}
export function verifyIdentity(
  row: Record<string, unknown>,
  c: ClientConfig,
  p?: RemoteProfile,
  external?: ExternalTlsEvidence,
) {
  if (row.database !== c.database || row.actor !== c.user || row.effective !== c.user)
    throw new Error('database_identity_mismatch');
  if (p) {
    const proxyVerified =
      p.neonProxy !== undefined &&
      [
        'ep-icy-meadow-b4zhj5uj.c-6.us-east-2.aws.neon.tech',
        'ep-billowing-silence-b4pbe6g5.c-6.us-east-2.aws.neon.tech',
      ].includes(p.neonProxy.host) &&
      p.host === p.neonProxy.host &&
      p.database === 'is488_epic002_validation' &&
      external?.host === p.host &&
      external.authorized === true &&
      ['TLSv1.2', 'TLSv1.3'].includes(external.protocol) &&
      !!external.fingerprint256;
    if (
      (p.neonProxy ? !proxyVerified : row.tls !== true) ||
      !p.versions.includes(Number(row.version))
    )
      throw new Error('remote_identity_rejected');
  } else if (!['127.0.0.1', '::1'].includes(String(row.address)))
    throw new Error('local_identity_mismatch');
}
