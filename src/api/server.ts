import express, { Express } from 'express';
import cors from 'cors';
import path from 'path';
import { backupRoutes } from './routes/backup.js';
import { restoreRoutes } from './routes/restore.js';
import { snapshotRoutes } from './routes/snapshots.js';
import { settingsRoutes } from './routes/settings.js';

const DEFAULT_PORT = 11480;

export function createServer(): Express {
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json());

  // API routes
  app.use('/api/backup', backupRoutes);
  app.use('/api/restore', restoreRoutes);
  app.use('/api/snapshots', snapshotRoutes);
  app.use('/api/settings', settingsRoutes);

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', version: '0.1.0' });
  });

  // Serve static frontend in production
  const webDir = path.join(import.meta.dirname, '../../web/dist');
  app.use(express.static(webDir));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(webDir, 'index.html'));
  });

  return app;
}

export function startServer(port: number = DEFAULT_PORT): void {
  const app = createServer();

  app.listen(port, () => {
    console.log(`🦞 openclaw-backup server running at http://localhost:${port}`);
  });
}
