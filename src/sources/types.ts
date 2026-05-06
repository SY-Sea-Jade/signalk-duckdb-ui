import type { DuckDBConnection } from '@duckdb/node-api';

export interface DataSource {
  readonly id: string;
  readonly name: string;
  configure(conn: DuckDBConnection): Promise<void>;
}

export interface ParquetSourceConfig {
  directory: string;
}

export interface AdbcSourceConfig {
  historyApiUrl: string;
  token?: string;
}
