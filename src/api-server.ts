import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import express from 'express';
import type { DuckDbManager } from './duckdb-manager';

const uiPath = path.join(__dirname, 'ui', 'index.html');

// Attach query + schema + UI routes to any Express router/app.
// getDuckdb() may return null if the plugin hasn't been started yet.
export function setupRoutes(
  router: express.IRouter,
  getDuckdb: () => DuckDbManager | null,
): void {
  router.use(express.json({ limit: '1mb' }));

  router.get('/', (_req, res) => {
    if (fs.existsSync(uiPath)) {
      res.sendFile(uiPath);
    } else {
      res.status(503).send('UI not found — run npm run build');
    }
  });

  router.post('/query', async (req: express.Request, res: express.Response) => {
    const db = getDuckdb();
    if (!db) {
      res.status(503).json({ error: 'Plugin is not running' });
      return;
    }
    const sql: string = req.body?.sql ?? '';
    if (!sql.trim()) {
      res.status(400).json({ error: 'No SQL provided' });
      return;
    }
    try {
      res.json(await db.query(sql));
    } catch (err) {
      res.status(400).json({ error: String(err) });
    }
  });

  router.get('/schema', async (_req: express.Request, res: express.Response) => {
    const db = getDuckdb();
    if (!db) {
      res.status(503).json({ error: 'Plugin is not running' });
      return;
    }
    try {
      res.json(await db.getSchema());
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });
}

export class ApiServer {
  private server: http.Server | null = null;

  start(port: number, getDuckdb: () => DuckDbManager | null, log: (msg: string) => void): void {
    const app = express();
    setupRoutes(app, getDuckdb);
    this.server = app.listen(port, () => {
      log(`DuckDB UI available at http://localhost:${port}/`);
    });
  }

  stop(): void {
    this.server?.close();
    this.server = null;
  }
}
