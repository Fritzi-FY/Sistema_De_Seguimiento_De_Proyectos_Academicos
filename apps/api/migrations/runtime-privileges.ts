export class RuntimePrivilegesError extends Error {}
export interface QueryClient {
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}
export const runtimePolicy: { table: string; grants: string[]; since?: number }[] = [
  { table: 'public.projects', grants: ['SELECT', 'INSERT', 'UPDATE'] },
  { table: 'public.project_memberships', grants: ['SELECT', 'INSERT', 'UPDATE'] },
  { table: 'public.teacher_project_assignments', grants: ['SELECT'] },
  { table: 'public.boards', grants: ['SELECT', 'INSERT', 'UPDATE'], since: 3 },
  { table: 'public.board_columns', grants: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'], since: 3 },
  { table: 'public.tasks', grants: ['SELECT', 'INSERT', 'UPDATE'], since: 3 },
  { table: 'public.task_assignees', grants: ['SELECT', 'INSERT', 'DELETE'], since: 3 },
  { table: 'public.task_activity', grants: ['SELECT', 'INSERT'], since: 3 },
];
const quote = (s: string) => {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(s)) throw new RuntimePrivilegesError('invalid_role');
  return '"' + s + '"';
};
export async function grantRuntime(client: QueryClient, runtime: string, schemaVersion = 2) {
  for (const p of runtimePolicy.filter((p) => (p.since ?? 1) <= schemaVersion)) {
    const r = await client.query('SELECT to_regclass($1) AS relation', [p.table]);
    if (!r.rows[0]?.relation) continue;
    await client.query('REVOKE ALL ON ' + p.table + ' FROM PUBLIC,' + quote(runtime));
    await client.query('GRANT ' + p.grants.join(',') + ' ON ' + p.table + ' TO ' + quote(runtime));
  }
}
export async function verifyPrincipals(client: QueryClient, runtime: string) {
  const roles = await client.query(
    `SELECT r.rolname,r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls AS elevated,
 EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid) AS member FROM pg_roles r WHERE r.rolname=$1 OR r.rolname=current_user`,
    [runtime],
  );
  if (roles.rows.length !== 2 || roles.rows.some((r) => r.elevated || r.member))
    throw new RuntimePrivilegesError('unsafe_roles');
  const base = await client.query(
    `SELECT has_schema_privilege($1,'public','CREATE') OR has_database_privilege($1,current_database(),'CREATE,TEMPORARY') OR (SELECT pg_get_userbyid(datdba)=$1 FROM pg_database WHERE datname=current_database()) AS unsafe`,
    [runtime],
  );
  if (base.rows[0]?.unsafe) throw new RuntimePrivilegesError('runtime_ddl_or_owner');
}
export async function verifyRuntime(client: QueryClient, runtime: string, schemaVersion = 2) {
  await verifyPrincipals(client, runtime);
  const version = Number(
    (await client.query("SELECT current_setting('server_version_num')::int AS version")).rows[0]
      ?.version,
  );
  if (!Number.isInteger(version) || version < 170000 || version >= 190000)
    throw new RuntimePrivilegesError('unsupported_privilege_version');
  const privileges = [
    'SELECT',
    'INSERT',
    'UPDATE',
    'DELETE',
    'TRUNCATE',
    'REFERENCES',
    'TRIGGER',
    ...(version >= 170000 ? ['MAINTAIN'] : []),
  ];
  const schema = await client.query(
    `SELECT nspname,pg_get_userbyid(nspowner) AS owner,has_schema_privilege($1,oid,'USAGE,CREATE') AS access FROM pg_namespace WHERE nspname='is488_migrations'`,
    [runtime],
  );
  const current = (await client.query('SELECT current_user AS actor')).rows[0]?.actor;
  if (schema.rows.length !== 1 || schema.rows[0]?.access || schema.rows[0]?.owner !== current)
    throw new RuntimePrivilegesError('unsafe_ledger_schema');
  const ledger = await client.query(
    "SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid='is488_migrations.versions'::regclass",
  );
  if (ledger.rows[0]?.owner !== current) throw new RuntimePrivilegesError('unsafe_ledger_owner');
  const tables = [
    { table: 'is488_migrations.versions', grants: [] as string[] },
    ...runtimePolicy.filter((p) => (p.since ?? 1) <= schemaVersion),
  ];
  const checks = await client.query(
    `WITH targets AS (
      SELECT name, to_regclass(name) AS oid FROM unnest($2::text[]) AS t(name)
    )
    SELECT t.name AS table_name,p.privilege,t.oid IS NOT NULL AS present,
      pg_get_userbyid(c.relowner)=$1 AS owned,
      has_table_privilege($1,t.oid,p.privilege) AS allowed,
      has_table_privilege($1,t.oid,p.privilege||' WITH GRANT OPTION') AS delegation,
      CASE WHEN p.privilege IN ('SELECT','INSERT','UPDATE','REFERENCES')
        THEN has_any_column_privilege($1,t.oid,p.privilege||' WITH GRANT OPTION') ELSE false END AS column_delegation,
      CASE WHEN p.privilege IN ('SELECT','INSERT','UPDATE','REFERENCES')
        THEN has_any_column_privilege($1,t.oid,p.privilege) ELSE false END AS column_allowed
    FROM targets t CROSS JOIN unnest($3::text[]) AS p(privilege)
    LEFT JOIN pg_class c ON c.oid=t.oid`,
    [runtime, tables.map((t) => t.table), privileges],
  );
  const seen = new Set<string>();
  for (const row of checks.rows) {
    const table = tables.find((t) => t.table === row.table_name);
    const privilege = String(row.privilege);
    const key = String(row.table_name) + ':' + privilege;
    if (!table || !privileges.includes(privilege) || seen.has(key))
      throw new RuntimePrivilegesError('invalid_acl_result');
    seen.add(key);
    if (row.present !== true) {
      if (table.table === 'public.teacher_project_assignments') continue;
      throw new RuntimePrivilegesError('missing_policy_table');
    }
    if (row.owned) throw new RuntimePrivilegesError('runtime_owner');
    if (row.allowed !== table.grants.includes(privilege))
      throw new RuntimePrivilegesError('unsafe_runtime_acl');
    if (row.delegation) throw new RuntimePrivilegesError('unsafe_grant_option');
    if (row.column_delegation) throw new RuntimePrivilegesError('unsafe_column_grant_option');
    if (!table.grants.includes(privilege) && row.column_allowed)
      throw new RuntimePrivilegesError('unsafe_column_acl');
  }
  if (seen.size !== tables.length * privileges.length)
    throw new RuntimePrivilegesError('incomplete_acl_result');
}
