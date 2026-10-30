import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyRuntime, runtimePolicy, type QueryClient } from './runtime-privileges.ts';
function database(problem = ''): QueryClient {
  return {
    async query(sql, values = []) {
      if (sql.includes('WITH targets AS')) {
        const tables = values[1] as string[];
        const privileges = values[2] as string[];
        const rows = tables.flatMap((table) =>
          privileges.map((privilege) => ({
            table_name: table,
            privilege,
            present:
              problem !== 'missing_table' &&
              !(problem === 'missing_board' && table === 'public.boards'),
            owned: problem === 'table_owner',
            allowed:
              (problem === 'maintain' && privilege === 'MAINTAIN') ||
              !!runtimePolicy.find((p) => p.table === table)?.grants.includes(privilege),
            delegation: problem === 'grant_option',
            column_delegation: problem === 'column_grant_option',
            column_allowed: problem === 'column',
          })),
        );
        if (problem === 'truncated') rows.pop();
        if (problem === 'duplicate') rows.push(rows[0]);
        return { rows };
      }
      const table = String(values[1]);
      if (sql.includes('server_version_num')) return { rows: [{ version: 180006 }] };
      if (sql.includes('FROM pg_roles'))
        return {
          rows: [
            { rolname: 'migrator', elevated: false, member: false },
            { rolname: 'runtime', elevated: problem === 'role', member: problem === 'member' },
          ],
        };
      if (sql.includes('AS unsafe')) return { rows: [{ unsafe: problem === 'ddl' }] };
      if (sql.includes('FROM pg_namespace'))
        return {
          rows: [
            {
              owner: problem === 'schema_owner' ? 'other' : 'migrator',
              access: problem === 'schema_usage',
            },
          ],
        };
      if (sql === 'SELECT current_user AS actor') return { rows: [{ actor: 'migrator' }] };
      if (sql.includes('AS owner FROM pg_class'))
        return { rows: [{ owner: problem === 'ledger_owner' ? 'other' : 'migrator' }] };
      if (sql.includes('to_regclass')) return { rows: [{ relation: true }] };
      if (sql.includes('AS owned')) return { rows: [{ owned: problem === 'table_owner' }] };
      if (sql.includes('has_any_column')) return { rows: [{ allowed: problem === 'column' }] };
      if (sql.includes('has_table_privilege'))
        return {
          rows: [
            {
              allowed:
                (problem === 'maintain' && values[2] === 'MAINTAIN') ||
                !!runtimePolicy.find((p) => p.table === table)?.grants.includes(String(values[2])),
            },
          ],
        };
      throw new Error('unexpected query');
    },
  };
}
test('ACL verifier covers MAINTAIN, columns, roles, defaults-derived effective ACL and ownership', async () => {
  await verifyRuntime(database(), 'runtime');
  for (const p of [
    'role',
    'member',
    'ddl',
    'schema_owner',
    'schema_usage',
    'ledger_owner',
    'table_owner',
    'column',
    'maintain',
    'grant_option',
    'column_grant_option',
    'missing_table',
    'truncated',
    'duplicate',
  ])
    await assert.rejects(verifyRuntime(database(p), 'runtime'));
});
