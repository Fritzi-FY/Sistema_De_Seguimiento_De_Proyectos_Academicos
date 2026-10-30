import { AsyncLocalStorage } from 'node:async_hooks';
import { Client, type ClientConfig, type QueryResult, type QueryResultRow } from 'pg';
export type TransactionOutcome = 'committed' | 'rolled_back' | 'unknown';
export class PersistenceTransactionError extends Error {
  constructor(
    readonly outcome: Exclude<TransactionOutcome, 'committed'>,
    readonly sqlState?: string,
    readonly constraint?: string,
  ) {
    super(outcome === 'rolled_back' ? 'Transaction rolled back' : 'Transaction outcome unknown');
    this.name = 'PersistenceTransactionError';
  }
}
export class SqlSession {
  private pending?: Promise<Client>;
  private client?: Client;
  private tail: Promise<unknown> = Promise.resolve();
  private context = new AsyncLocalStorage<boolean>();
  private uncertain = false;
  constructor(
    private readonly config: ClientConfig,
    private readonly requester?: () => string | undefined,
  ) {}
  get actorId(): string | undefined {
    return this.requester?.();
  }
  private connect() {
    this.pending ??= (async () => {
      const c = new Client({ ...this.config, connectionTimeoutMillis: 5000, query_timeout: 6000 });
      this.client = c;
      c.on('error', () => {});
      await c.connect();
      return c;
    })();
    return this.pending;
  }
  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<T>> {
    if (this.context.getStore()) return (await this.connect()).query<T>(text, values);
    return this.transaction(() => this.query<T>(text, values));
  }
  transaction<T>(work: () => Promise<T>): Promise<T> {
    if (this.context.getStore()) return work();
    const result = this.tail.then(() =>
      this.context.run(true, async () => {
        if (this.uncertain) throw new PersistenceTransactionError('unknown');
        const c = await this.connect();
        let begun = false,
          commit = false;
        try {
          await c.query('BEGIN');
          begun = true;
          await c.query('SET LOCAL search_path TO pg_catalog, public');
          await c.query("SET LOCAL statement_timeout = '5s'");
          await c.query("SET LOCAL lock_timeout = '2s'");
          await c.query("SET LOCAL transaction_timeout = '10s'");
          const value = await work();
          commit = true;
          await c.query('COMMIT');
          return value;
        } catch (error) {
          if (commit || !begun) {
            this.uncertain = true;
            throw new PersistenceTransactionError('unknown');
          }
          try {
            await c.query('ROLLBACK');
          } catch {
            this.uncertain = true;
            throw new PersistenceTransactionError('unknown');
          }
          const detail = error as { code?: string; constraint?: string };
          throw new PersistenceTransactionError('rolled_back', detail.code, detail.constraint);
        }
      }),
    );
    this.tail = result.catch(() => {});
    return result;
  }
  async close(): Promise<boolean> {
    if (!this.client) return true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.client.end().then(
          () => true,
          () => false,
        ),
        new Promise<false>((r) => {
          timer = setTimeout(() => r(false), 1000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
export const sqlRequestScope = new AsyncLocalStorage<SqlSession | null>();
export function currentSqlSession(): SqlSession {
  const s = sqlRequestScope.getStore();
  if (!s) throw new Error('SQL request scope required');
  return s;
}
