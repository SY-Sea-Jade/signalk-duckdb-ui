import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import express from 'express';
import type { DuckDbManager } from './duckdb-manager';

export class ApiServer {
  private server: http.Server | null = null;

  constructor(private duckdb: DuckDbManager) {}

  start(port: number, log: (msg: string) => void): void {
    const app = express();
    app.use(express.json({ limit: '1mb' }));

    const uiPath = path.join(__dirname, 'ui', 'index.html');

    app.get('/', (_req, res) => {
      if (fs.existsSync(uiPath)) {
        res.sendFile(uiPath);
      } else {
        res.status(503).send('UI not found — run npm run build');
      }
    });

    app.post('/query', async (req, res) => {
      const sql: string = req.body?.sql ?? '';
      if (!sql.trim()) {
        res.status(400).json({ error: 'No SQL provided' });
        return;
      }
      try {
        const result = await this.duckdb.query(sql);
        res.json(result);
      } catch (err) {
        res.status(400).json({ error: String(err) });
      }
    });

    app.get('/schema', async (_req, res) => {
      try {
        const schema = await this.duckdb.getSchema();
        res.json(schema);
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    });

    this.server = app.listen(port, () => {
      log(`DuckDB UI available at http://localhost:${port}/`);
    });
  }

  stop(): void {
    this.server?.close();
    this.server = null;
  }
}
