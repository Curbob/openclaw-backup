import express, { Express } from 'express';
import cors from 'cors';
import path from 'path';
import { backupRoutes } from './routes/backup.js';
import { restoreRoutes } from './routes/restore.js';
import { snapshotRoutes } from './routes/snapshots.js';
import { settingsRoutes } from './routes/settings.js';
import { scheduleRoutes } from './routes/schedule.js';
import { initDb, getStats } from '../core/db.js';
import { startScheduler, getScheduleConfig } from '../core/scheduler.js';

const DEFAULT_PORT = 11480;

export function createServer(): Express {
  // Initialize database on server start
  initDb();
  
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json());

  // API routes
  app.use('/api/backup', backupRoutes);
  app.use('/api/restore', restoreRoutes);
  app.use('/api/snapshots', snapshotRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/schedule', scheduleRoutes);

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', version: '0.1.0' });
  });

  // Stats endpoint
  app.get('/api/stats', (_req, res) => {
    const stats = getStats();
    res.json(stats);
  });

  // Serve static frontend in production
  const webDir = path.join(import.meta.dirname, '../web');
  app.use(express.static(webDir));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(webDir, 'index.html'));
  });

  return app;
}

export function startServer(port: number = DEFAULT_PORT, enableScheduler = true): void {
  const app = createServer();

  app.listen(port, () => {
    console.log(`🦞 openclaw-backup server running at http://localhost:${port}`);
    
    // Start scheduler if enabled
    if (enableScheduler) {
      const config = getScheduleConfig();
      if (config.enabled) {
        const started = startScheduler();
        if (started) {
          console.log(`📅 Scheduler started: ${config.cron}`);
        }
      }
    }
  });
}
