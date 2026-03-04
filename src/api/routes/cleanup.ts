import { Router, Request, Response } from 'express';
import {
  findOrphanChunks,
  cleanupOrphanChunks,
  verifyIntegrity,
  CleanupStats,
  CleanupResult,
} from '../../core/cleanup.js';

export const cleanupRoutes = Router();

interface CleanupStatus {
  running: boolean;
  phase: string;
  current: number;
  total: number;
  message: string;
  lastResult: CleanupResult | null;
}

let cleanupStatus: CleanupStatus = {
  running: false,
  phase: 'idle',
  current: 0,
  total: 0,
  message: '',
  lastResult: null,
};

// GET /api/cleanup/status
cleanupRoutes.get('/status', (_req: Request, res: Response) => {
  res.json(cleanupStatus);
});

// GET /api/cleanup/scan - Scan for orphans (dry run)
cleanupRoutes.get('/scan', async (_req: Request, res: Response) => {
  if (cleanupStatus.running) {
    res.status(409).json({ error: 'Cleanup already in progress' });
    return;
  }

  cleanupStatus.running = true;
  cleanupStatus.phase = 'scanning';
  cleanupStatus.message = 'Starting scan...';

  try {
    const stats = await findOrphanChunks((progress) => {
      cleanupStatus.phase = progress.phase;
      cleanupStatus.current = progress.current;
      cleanupStatus.total = progress.total;
      cleanupStatus.message = progress.message;
    });

    cleanupStatus.running = false;
    cleanupStatus.phase = 'idle';
    
    res.json({
      success: true,
      stats,
    });
  } catch (err: any) {
    cleanupStatus.running = false;
    cleanupStatus.phase = 'idle';
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cleanup/run - Run cleanup
cleanupRoutes.post('/run', async (req: Request, res: Response) => {
  if (cleanupStatus.running) {
    res.status(409).json({ error: 'Cleanup already in progress' });
    return;
  }

  const dryRun = req.body.dryRun ?? false;

  cleanupStatus.running = true;
  cleanupStatus.phase = 'starting';
  cleanupStatus.message = 'Starting cleanup...';

  // Run in background
  runCleanup(dryRun);

  res.json({ 
    message: dryRun ? 'Scan started' : 'Cleanup started',
    dryRun,
  });
});

async function runCleanup(dryRun: boolean): Promise<void> {
  try {
    const result = await cleanupOrphanChunks({
      dryRun,
      onProgress: (progress) => {
        cleanupStatus.phase = progress.phase;
        cleanupStatus.current = progress.current;
        cleanupStatus.total = progress.total;
        cleanupStatus.message = progress.message;
      },
    });

    cleanupStatus.lastResult = result;
    cleanupStatus.running = false;
    cleanupStatus.phase = 'complete';
    cleanupStatus.message = dryRun 
      ? `Found ${result.orphanChunks} orphan chunks` 
      : `Deleted ${result.deletedChunks} orphan chunks`;

  } catch (err: any) {
    cleanupStatus.running = false;
    cleanupStatus.phase = 'error';
    cleanupStatus.message = err.message;
  }
}

// GET /api/cleanup/verify - Verify database integrity
cleanupRoutes.get('/verify', async (_req: Request, res: Response) => {
  try {
    const result = await verifyIntegrity();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
