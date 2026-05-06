import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import express from 'express';
import type { DuckDbManager } from './duckdb-manager';

const uiPath = path.join(__dirname, 'ui', 'index.html');

function serveUi(_req: express.Request, res: express.Response): void {
  if (fs.existsSync(uiPath)) {
    res.sendFile(uiPath);
  } else {
    res.status(503).send('UI not found — run npm run build');
  }
}

// Attach API + UI routes to a router provided by SignalK's registerWithRouter.
// Note: SignalK already owns GET / on the plugin router (returns plugin metadata),
// so the UI is served at GET /ui instead.
export function setupRoutes(
  router: express.IRouter,
  getDuckdb: () => DuckDbManager | null,
): void {
  router.use(express.json({ limit: '1mb' }));

  router.get('/ui', serveUi);

  router.post('/query', async (req: express.Request, res: express.Response) => {
    const db = getDuckdb();
    if (!db) { res.status(503).json({ error: 'Plugin is not running' }); return; }
    const sql: string = req.body?.sql ?? '';
    if (!sql.trim()) { res.status(400).json({ error: 'No SQL provided' }); return; }
    try {
      res.json(await db.query(sql));
    } catch (err) {
      res.status(400).json({ error: String(err) });
    }
  });

  router.get('/schema', async (_req: express.Request, res: express.Response) => {
    const db = getDuckdb();
    if (!db) { res.status(503).json({ error: 'Plugin is not running' }); return; }
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
    // Standalone server owns GET /, so serve the UI there too
    app.get('/', serveUi);
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
