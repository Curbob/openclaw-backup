import { Router, Request, Response } from 'express';

export const restoreRoutes = Router();

interface RestoreStatus {
  running: boolean;
  snapshotId: string | null;
  targetPath: string | null;
  filesRestored: number;
  totalFiles: number;
  bytesRestored: number;
  errors: string[];
}

let restoreStatus: RestoreStatus = {
  running: false,
  snapshotId: null,
  targetPath: null,
  filesRestored: 0,
  totalFiles: 0,
  bytesRestored: 0,
  errors: [],
};

// GET /api/restore/status
restoreRoutes.get('/status', (_req: Request, res: Response) => {
  res.json(restoreStatus);
});

// POST /api/restore/start
restoreRoutes.post('/start', async (req: Request, res: Response) => {
  if (restoreStatus.running) {
    res.status(409).json({ error: 'Restore already in progress' });
    return;
  }

  const { snapshotId, targetPath, files } = req.body;

  if (!snapshotId) {
    res.status(400).json({ error: 'snapshotId required' });
    return;
  }

  // TODO: Wire up actual restore logic
  restoreStatus = {
    running: true,
    snapshotId,
    targetPath: targetPath || null,
    filesRestored: 0,
    totalFiles: files?.length || 0,
    bytesRestored: 0,
    errors: [],
  };

  console.log(`Starting restore of snapshot: ${snapshotId}`);
  if (files) {
    console.log(`Restoring specific files: ${files.join(', ')}`);
  }

  // Simulate restore (replace with real implementation)
  setTimeout(() => {
    restoreStatus.running = false;
    restoreStatus.filesRestored = restoreStatus.totalFiles || 50;
    restoreStatus.bytesRestored = 15_000_000;
  }, 3000);

  res.json({ 
    message: 'Restore started', 
    snapshotId,
    targetPath: targetPath || '(original locations)',
  });
});

// POST /api/restore/stop
restoreRoutes.post('/stop', (_req: Request, res: Response) => {
  if (!restoreStatus.running) {
    res.status(400).json({ error: 'No restore in progress' });
    return;
  }

  restoreStatus.running = false;
  res.json({ message: 'Restore cancelled' });
});

// POST /api/restore/preview
restoreRoutes.post('/preview', (req: Request, res: Response) => {
  const { snapshotId, targetPath } = req.body;

  // TODO: Actually diff snapshot against target
  res.json({
    snapshotId,
    targetPath: targetPath || '(original locations)',
    changes: {
      new: ['memory/2026-03-03.md'],
      modified: ['AGENTS.md', 'TOOLS.md'],
      deleted: [],
      unchanged: 1244,
    },
  });
});
