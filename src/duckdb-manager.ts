import { DuckDBInstance } from '@duckdb/node-api';
import type { DuckDBConnection } from '@duckdb/node-api';
import type { DataSource } from './sources/types';

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  durationMs: number;
}

export interface SchemaObject {
  name: string;
  type: 'view' | 'table';
  columns: { name: string; type: string }[];
}

export class DuckDbManager {
  private instance: DuckDBInstance | null = null;
  private connection: DuckDBConnection | null = null;

  async start(sources: DataSource[], log: (msg: string) => void): Promise<void> {
    this.instance = await DuckDBInstance.create(':memory:');
    this.connection = await this.instance.connect();

    for (const source of sources) {
      log(`Configuring data source: ${source.name}`);
      try {
        await source.configure(this.connection);
        log(`Data source ready: ${source.name}`);
      } catch (err) {
        log(`Warning: failed to configure ${source.name}: ${err}`);
      }
    }
  }

  async query(sql: string): Promise<QueryResult> {
    if (!this.connection) throw new Error('DuckDB not initialized');

    const t0 = Date.now();
    const result = await this.connection.runAndReadAll(sql);

    const columns = result.columnNames();
    const rows = result.getRows().map((row) =>
      row.map((cell) => {
        if (cell === null || cell === undefined) return null;
        // BigInt can't be JSON-serialized; convert to string to preserve precision
        if (typeof cell === 'bigint') return cell.toString();
        return cell;
      }),
    );

    return {
      columns,
      rows,
      rowCount: rows.length,
      durationMs: Date.now() - t0,
    };
  }

  async getSchema(): Promise<SchemaObject[]> {
    if (!this.connection) return [];

    const tablesResult = await this.connection.runAndReadAll(`
      SELECT table_name, table_type
      FROM information_schema.tables
      WHERE table_schema = 'main'
      ORDER BY table_type DESC, table_name
    `);

    const objects: SchemaObject[] = [];

    for (const row of tablesResult.getRows()) {
      const name = String(row[0]);
      const rawType = String(row[1]);
      const type: 'view' | 'table' = rawType === 'VIEW' ? 'view' : 'table';

      try {
        const colResult = await this.connection.runAndReadAll(
          `DESCRIBE "${name.replace(/"/g, '""')}"`,
        );
        const columns = colResult.getRows().map((r) => ({
          name: String(r[0]),
          type: String(r[1]),
        }));
        objects.push({ name, type, columns });
      } catch {
        objects.push({ name, type, columns: [] });
      }
    }

    return objects;
  }

  async stop(): Promise<void> {
    this.connection = null;
    this.instance = null;
    await new Promise<void>((r) => setImmediate(r));
  }
}
