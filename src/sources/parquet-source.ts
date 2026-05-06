import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import type { DuckDBConnection } from '@duckdb/node-api';
import type { DataSource, ParquetSourceConfig } from './types';

// signalk-parquet uses Hive-style partitioning:
// tier={tier}/context={context}/path={path}/year={year}/day={day}/
const HIVE_PATTERN = /tier=([^/]+)\/context=([^/]+)/;
const SKIP_DIRS = new Set(['processed', 'failed', 'quarantine', 'claude-schemas', 'repaired']);

export class ParquetSource implements DataSource {
  readonly id = 'parquet';
  readonly name = 'SignalK Parquet Archive';

  constructor(private config: ParquetSourceConfig) {}

  async configure(conn: DuckDBConnection): Promise<void> {
    const dir = this.config.directory;

    if (!fs.existsSync(dir)) {
      throw new Error(`Parquet directory does not exist: ${dir}`);
    }

    const files = await glob('**/*.parquet', {
      cwd: dir,
      absolute: true,
      ignore: Array.from(SKIP_DIRS).map((d) => `**/${d}/**`),
    });

    if (files.length === 0) {
      // Create an empty placeholder view so DuckDB UI still shows something
      await conn.runAndReadAll(`
        CREATE OR REPLACE VIEW signalk_data AS
        SELECT NULL::TIMESTAMP AS timestamp, NULL::VARCHAR AS context,
               NULL::VARCHAR AS path, NULL::DOUBLE AS value
        WHERE false;
      `);
      return;
    }

    const escapedDir = dir.replace(/'/g, "''");
    const isHive = files.some((f) => HIVE_PATTERN.test(f));

    if (isHive) {
      await this.createHiveViews(conn, escapedDir, files);
    } else {
      await this.createFlatView(conn, escapedDir);
    }
  }

  private async createHiveViews(
    conn: DuckDBConnection,
    escapedDir: string,
    files: string[],
  ): Promise<void> {
    // One unified view across all Hive-partitioned files
    await conn.runAndReadAll(`
      CREATE OR REPLACE VIEW signalk_data AS
      SELECT *
      FROM read_parquet('${escapedDir}/**/*.parquet',
        union_by_name = true,
        hive_partitioning = true
      );
    `);

    // Convenience view: distinct contexts (vessels)
    await conn.runAndReadAll(`
      CREATE OR REPLACE VIEW signalk_contexts AS
      SELECT DISTINCT context FROM signalk_data ORDER BY context;
    `);

    // Per-context views for any contexts discovered from directory names
    const contexts = this.extractContexts(files);
    for (const ctx of contexts) {
      const safeName = ctx.replace(/[^a-zA-Z0-9_]/g, '_');
      const escapedCtx = ctx.replace(/'/g, "''");
      await conn.runAndReadAll(`
        CREATE OR REPLACE VIEW signalk_${safeName} AS
        SELECT * FROM signalk_data WHERE context = '${escapedCtx}';
      `);
    }
  }

  private async createFlatView(conn: DuckDBConnection, escapedDir: string): Promise<void> {
    await conn.runAndReadAll(`
      CREATE OR REPLACE VIEW signalk_data AS
      SELECT *
      FROM read_parquet('${escapedDir}/**/*.parquet', union_by_name = true);
    `);
  }

  private extractContexts(files: string[]): string[] {
    const contexts = new Set<string>();
    for (const f of files) {
      const m = f.match(/context=([^/]+)/);
      if (m) contexts.add(decodeURIComponent(m[1]));
    }
    return Array.from(contexts);
  }
}
