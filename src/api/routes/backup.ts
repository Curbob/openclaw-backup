import { Router, Request, Response } from 'express';

export const backupRoutes = Router();

interface BackupStatus {
  running: boolean;
  lastRun: string | null;
  lastDuration: number | null;
  nextScheduled: string | null;
  chunksProcessed: number;
  bytesProcessed: number;
  errors: string[];
}

// In-memory state (will be replaced with DB)
let backupStatus: BackupStatus = {
  running: false,
  lastRun: null,
  lastDuration: null,
  nextScheduled: null,
  chunksProcessed: 0,
  bytesProcessed: 0,
  errors: [],
};

// GET /api/backup/status
backupRoutes.get('/status', (_req: Request, res: Response) => {
  res.json(backupStatus);
});

// POST /api/backup/start
backupRoutes.post('/start', async (req: Request, res: Response) => {
  if (backupStatus.running) {
    res.status(409).json({ error: 'Backup already in progress' });
    return;
  }

  const sourcePath = req.body.sourcePath || process.env.OPENCLAW_WORKSPACE || '~/clawd';
  
  // TODO: Wire up actual backup logic
  backupStatus.running = true;
  backupStatus.chunksProcessed = 0;
  backupStatus.bytesProcessed = 0;
  backupStatus.errors = [];

  console.log(`Starting backup of: ${sourcePath}`);

  // Simulate backup (replace with real implementation)
  setTimeout(() => {
    backupStatus.running = false;
    backupStatus.lastRun = new Date().toISOString();
    backupStatus.lastDuration = 12500; // ms
    backupStatus.chunksProcessed = 142;
    backupStatus.bytesProcessed = 15_400_000;
  }, 2000);

  res.json({ message: 'Backup started', sourcePath });
});

// POST /api/backup/stop
backupRoutes.post('/stop', (_req: Request, res: Response) => {
  if (!backupStatus.running) {
    res.status(400).json({ error: 'No backup in progress' });
    return;
  }

  // TODO: Implement graceful cancellation
  backupStatus.running = false;
  res.json({ message: 'Backup cancelled' });
});
