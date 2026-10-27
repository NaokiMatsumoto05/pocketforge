import { DatabaseSync } from 'node:sqlite';
import { Pool, type PoolClient } from 'pg';
import { readFileSync } from 'node:fs';

export interface Database {
  kind: 'sqlite' | 'postgres';
  all(sql: string, ...values: any[]): Promise<any[]>;
  get(sql: string, ...values: any[]): Promise<any>;
  run(sql: string, ...values: any[]): Promise<void>;
  transaction<T>(work: (db: Database) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

// Every SQLite operation shares the queue, so unrelated requests cannot enter a transaction.
export class SQLiteDatabase implements Database {
  kind = 'sqlite' as const;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    private raw: DatabaseSync,
    private inTransaction = false,
  ) {}
  private exclusive<T>(work: () => Promise<T> | T): Promise<T> {
    if (this.inTransaction) return Promise.resolve().then(work);
    const result = this.tail.then(work);
    this.tail = result.catch(() => {});
    return result;
  }
  all(sql: string, ...values: any[]) {
    return this.exclusive(() => this.raw.prepare(sql).all(...values));
  }
  get(sql: string, ...values: any[]) {
    return this.exclusive(() => this.raw.prepare(sql).get(...values));
  }
  run(sql: string, ...values: any[]) {
    return this.exclusive(() => {
      this.raw.prepare(sql).run(...values);
    });
  }
  transaction<T>(work: (db: Database) => Promise<T>): Promise<T> {
    return this.exclusive(async () => {
      this.raw.exec('BEGIN IMMEDIATE');
      try {
        const result = await work(new SQLiteDatabase(this.raw, true));
        this.raw.exec('COMMIT');
        return result;
      } catch (e) {
        this.raw.exec('ROLLBACK');
        throw e;
      }
    });
  }
  close() {
    return this.exclusive(() => this.raw.close());
  }
}

export function postgresOptions(connectionString: string) {
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol))
    throw new Error('DATABASE_URL must be a PostgreSQL URL.');
  // URL SSL parameters override pg's ssl object. Always verify the server certificate.
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat'])
    url.searchParams.delete(key);
  return {
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: true },
    max: 3,
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 30000,
    statement_timeout: 30000,
    application_name: 'pocketforge',
  };
}

export class PostgresDatabase implements Database {
  kind = 'postgres' as const;
  constructor(
    private pool: Pool,
    private client?: PoolClient,
  ) {}
  private sql(sql: string) {
    let i = 0;
    // Only fixed application SQL is passed here; values always remain parameters.
    return sql.replace(/\?/g, () => '$' + ++i);
  }
  async all(sql: string, ...values: any[]) {
    return (await (this.client ?? this.pool).query(this.sql(sql), values)).rows;
  }
  async get(sql: string, ...values: any[]) {
    return (await this.all(sql, ...values))[0];
  }
  async run(sql: string, ...values: any[]) {
    await this.all(sql, ...values);
  }
  async transaction<T>(work: (db: Database) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(new PostgresDatabase(this.pool, client));
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
  async close() {
    await this.pool.end();
  }
  static async open(url: string) {
    const pool = new Pool(postgresOptions(url));
    // Never log connection errors verbatim: they can contain connection details.
    pool.on('error', () => console.error('PostgreSQL idle connection failed.'));
    const db = new PostgresDatabase(pool);
    try {
      await db.transaction(async (tx) => {
        await tx.run('SELECT pg_advisory_xact_lock(74156001)');
        await tx.run(
          readFileSync(new URL('../migrations/001_initial.sql', import.meta.url), 'utf8'),
        );
      });
      return db;
    } catch (e) {
      await pool.end();
      throw e;
    }
  }
}
