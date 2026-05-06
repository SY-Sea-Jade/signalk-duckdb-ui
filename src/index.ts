import { DuckDbManager } from './duckdb-manager';
import { ApiServer, setupRoutes } from './api-server';
import { ParquetSource } from './sources/parquet-source';
import type { DataSource } from './sources/types';

interface PluginConfig {
  port: number;
  sources: {
    parquet: {
      enabled: boolean;
      directory: string;
    };
  };
}

const PLUGIN_ID = 'signalk-duckdb-ui';

module.exports = function (app: any) {
  const plugin: any = {
    id: PLUGIN_ID,
    name: 'DuckDB UI',
    description: 'DuckDB SQL interface for SignalK data (parquet archives, History API, and more)',
  };

  let duckdb: DuckDbManager | null = null;
  let apiServer: ApiServer | null = null;
  const getDuckdb = () => duckdb;

  // Mount routes on SignalK's own Express server at /plugins/signalk-duckdb-ui/
  // This is called at plugin load time, before start(), so getDuckdb() may return null.
  plugin.registerWithRouter = function (router: any) {
    setupRoutes(router, getDuckdb);
  };

  plugin.schema = {
    type: 'object',
    required: ['port'],
    properties: {
      port: {
        type: 'number',
        title: 'Web port',
        description:
          'Additional standalone port for direct access. The UI is also available via the SignalK server at /plugins/signalk-duckdb-ui/',
        default: 4213,
      },
      sources: {
        type: 'object',
        title: 'Data sources',
        properties: {
          parquet: {
            type: 'object',
            title: 'SignalK Parquet (signalk-parquet)',
            properties: {
              enabled: {
                type: 'boolean',
                title: 'Enable',
                default: true,
              },
              directory: {
                type: 'string',
                title: 'Parquet directory',
                description:
                  'Directory where signalk-parquet stores files. Leave empty to use the SignalK data directory.',
                default: '',
              },
            },
          },
        },
      },
    },
  };

  plugin.start = async function (options: PluginConfig): Promise<void> {
    const log = (msg: string) => app.debug(msg);
    const listenPort = options.port ?? 4213;

    const sources: DataSource[] = [];

    const parquetCfg = options.sources?.parquet;
    if (parquetCfg?.enabled !== false) {
      const dir = parquetCfg?.directory?.trim() || app.getDataDirPath();
      sources.push(new ParquetSource({ directory: dir }));
    }

    // Future sources (ADBC / SignalK History API) registered here

    duckdb = new DuckDbManager();
    await duckdb.start(sources, log);

    apiServer = new ApiServer();
    apiServer.start(listenPort, getDuckdb, log);

    app.setPluginStatus(
      `DuckDB UI: /plugins/${PLUGIN_ID}/ or http://localhost:${listenPort}/`,
    );
  };

  plugin.stop = async function (): Promise<void> {
    apiServer?.stop();
    apiServer = null;
    await duckdb?.stop();
    duckdb = null;
    app.setPluginStatus('Stopped');
  };

  return plugin;
};
