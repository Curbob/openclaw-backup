import { Router, Request, Response } from 'express';
import { getSnapshot, getFilesForSnapshot } from '../../core/db.js';
import { runRestore, RestoreProgress } from '../../core/backup.js';
import { homedir } from 'os';

export const restoreRoutes = Router();

interface RestoreStatus {
  running: boolean;
  phase: 'idle' | 'preparing' | 'downloading' | 'decrypting' | 'writing';
  snapshotId: string | null;
  targetPath: string | null;
  filesTotal: number;
  filesRestored: number;
  bytesRestored: number;
  errors: string[];
  startedAt: string | null;
}

let restoreStatus: RestoreStatus = {
  running: false,
  phase: 'idle',
  snapshotId: null,
  targetPath: null,
  filesTotal: 0,
  filesRestored: 0,
  bytesRestored: 0,
  errors: [],
  startedAt: null,
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

  // Verify snapshot exists
  const snapshot = getSnapshot(snapshotId);
  if (!snapshot) {
    res.status(404).json({ error: 'Snapshot not found' });
    return;
  }

  // Resolve target path
  let resolvedTargetPath = targetPath;
  if (resolvedTargetPath?.startsWith('~')) {
    resolvedTargetPath = resolvedTargetPath.replace('~', homedir());
  }

  // Get file count
  const snapshotFiles = getFilesForSnapshot(snapshotId);
  const filesToRestore = files 
    ? snapshotFiles.filter(f => files.includes(f.path))
    : snapshotFiles;

  // Reset status
  restoreStatus = {
    running: true,
    phase: 'preparing',
    snapshotId,
    targetPath: resolvedTargetPath || snapshot.sourcePath,
    filesTotal: filesToRestore.length,
    filesRestored: 0,
    bytesRestored: 0,
    errors: [],
    startedAt: new Date().toISOString(),
  };

  console.log(`[Restore] Starting restore of snapshot ${snapshotId}`);

  // Run restore in background
  runRestoreAsync(snapshotId, resolvedTargetPath, files);

  res.json({ 
    message: 'Restore started', 
    snapshotId,
    targetPath: restoreStatus.targetPath,
    filesTotal: restoreStatus.filesTotal,
  });
});

// POST /api/restore/stop
restoreRoutes.post('/stop', (_req: Request, res: Response) => {
  if (!restoreStatus.running) {
    res.status(400).json({ error: 'No restore in progress' });
    return;
  }

  // TODO: Implement graceful cancellation
  restoreStatus.running = false;
  restoreStatus.phase = 'idle';
  restoreStatus.errors.push('Restore cancelled by user');
  
  res.json({ message: 'Restore cancelled' });
});

// POST /api/restore/preview
restoreRoutes.post('/preview', async (req: Request, res: Response) => {
  const { snapshotId, targetPath } = req.body;

  if (!snapshotId) {
    res.status(400).json({ error: 'snapshotId required' });
    return;
  }

  const snapshot = getSnapshot(snapshotId);
  if (!snapshot) {
    res.status(404).json({ error: 'Snapshot not found' });
    return;
  }

  const files = getFilesForSnapshot(snapshotId);

  // TODO: Actually diff against target path
  // For now, just return file list
  res.json({
    snapshotId,
    targetPath: targetPath || snapshot.sourcePath,
    files: files.map(f => ({
      path: f.path,
      size: f.size,
      modified: f.modifiedAt,
    })),
    summary: {
      totalFiles: files.length,
      totalBytes: files.reduce((sum, f) => sum + f.size, 0),
    },
  });
});

/**
 * Run restore asynchronously
 */
async function runRestoreAsync(
  snapshotId: string,
  targetPath?: string,
  files?: string[]
): Promise<void> {
  try {
    const result = await runRestore({
      snapshotId,
      targetPath,
      files,
      onProgress: (progress: RestoreProgress) => {
        restoreStatus.phase = progress.phase;
        restoreStatus.filesRestored = progress.filesRestored;
        restoreStatus.bytesRestored = progress.bytesRestored;
        restoreStatus.errors = progress.errors;
      },
    });

    restoreStatus.running = false;
    restoreStatus.phase = 'idle';
    restoreStatus.errors = result.errors;

    console.log(`[Restore] Complete in ${result.duration}ms - ${result.filesRestored} files`);

  } catch (err: any) {
    console.error('[Restore] Failed:', err);
    restoreStatus.running = false;
    restoreStatus.phase = 'idle';
    restoreStatus.errors.push(err.message);
  }
}
