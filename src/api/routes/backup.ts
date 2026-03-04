import { Router, Request, Response } from 'express';
import { 
  getPrimaryDestination, 
  getStats, 
  getSetting,
} from '../../core/db.js';
import { 
  runBackup, 
  isEncryptionConfigured,
  BackupProgress,
} from '../../core/backup.js';
import { homedir } from 'os';
import { join } from 'path';

export const backupRoutes = Router();

interface BackupStatus {
  running: boolean;
  phase: 'idle' | 'scanning' | 'processing' | 'finalizing';
  lastRun: string | null;
  lastDuration: number | null;
  nextScheduled: string | null;
  currentFile: string | null;
  filesScanned: number;
  filesTotal: number;
  filesProcessed: number;
  chunksNew: number;
  chunksReused: number;
  bytesProcessed: number;
  bytesCompressed: number;
  bytesStored: number;
  compressionRatio: number;
  errors: string[];
  startedAt: string | null;
}

// In-memory state
let backupStatus: BackupStatus = {
  running: false,
  phase: 'idle',
  lastRun: null,
  lastDuration: null,
  nextScheduled: null,
  currentFile: null,
  filesScanned: 0,
  filesTotal: 0,
  filesProcessed: 0,
  chunksNew: 0,
  chunksReused: 0,
  bytesProcessed: 0,
  bytesCompressed: 0,
  bytesStored: 0,
  compressionRatio: 1,
  errors: [],
  startedAt: null,
};

let abortRequested = false;

// GET /api/backup/status
backupRoutes.get('/status', (_req: Request, res: Response) => {
  const stats = getStats();
  
  res.json({
    ...backupStatus,
    encryptionConfigured: isEncryptionConfigured(),
    stats: {
      totalSnapshots: stats.totalSnapshots,
      totalChunks: stats.totalChunks,
      totalBytes: stats.totalBytes,
      deduplicatedBytes: stats.deduplicatedBytes,
    },
  });
});

// POST /api/backup/start
backupRoutes.post('/start', async (req: Request, res: Response) => {
  if (backupStatus.running) {
    res.status(409).json({ error: 'Backup already in progress' });
    return;
  }

  // Check encryption is configured
  if (!isEncryptionConfigured()) {
    res.status(400).json({ error: 'Encryption not configured. Set up encryption in settings first.' });
    return;
  }

  // Resolve source path
  let sourcePath = req.body.sourcePath 
    || process.env.OPENCLAW_WORKSPACE 
    || join(homedir(), 'clawd');
  
  // Expand ~ to home directory
  if (sourcePath.startsWith('~')) {
    sourcePath = sourcePath.replace('~', homedir());
  }

  const label = req.body.label || null;
  
  // Get primary destination
  const destination = getPrimaryDestination();
  if (!destination) {
    res.status(400).json({ error: 'No backup destination configured' });
    return;
  }

  // Get exclude patterns from settings
  const excludePatternsJson = getSetting('excludePatterns');
  const excludePatterns = excludePatternsJson ? JSON.parse(excludePatternsJson) : undefined;

  // Reset status
  backupStatus = {
    running: true,
    phase: 'scanning',
    lastRun: backupStatus.lastRun,
    lastDuration: backupStatus.lastDuration,
    nextScheduled: backupStatus.nextScheduled,
    currentFile: null,
    filesScanned: 0,
    filesTotal: 0,
    filesProcessed: 0,
    chunksNew: 0,
    chunksReused: 0,
    bytesProcessed: 0,
    bytesCompressed: 0,
    bytesStored: 0,
    compressionRatio: 1,
    errors: [],
    startedAt: new Date().toISOString(),
  };
  abortRequested = false;

  console.log(`[Backup] Starting backup of: ${sourcePath}`);

  // Run backup in background
  runBackupAsync(sourcePath, label, excludePatterns);

  res.json({ 
    message: 'Backup started', 
    sourcePath,
    destination: destination.name,
  });
});

// POST /api/backup/stop
backupRoutes.post('/stop', (_req: Request, res: Response) => {
  if (!backupStatus.running) {
    res.status(400).json({ error: 'No backup in progress' });
    return;
  }

  abortRequested = true;
  backupStatus.errors.push('Backup cancelled by user');
  
  res.json({ message: 'Backup cancellation requested' });
});

/**
 * Run backup asynchronously
 */
async function runBackupAsync(
  sourcePath: string, 
  label: string | null,
  excludePatterns?: string[]
): Promise<void> {
  try {
    const result = await runBackup({
      sourcePath,
      label: label || undefined,
      excludePatterns,
      onProgress: (progress: BackupProgress) => {
        // Update status from progress
        backupStatus.phase = progress.phase;
        backupStatus.currentFile = progress.currentFile;
        backupStatus.filesScanned = progress.filesScanned;
        backupStatus.filesTotal = progress.filesTotal;
        backupStatus.filesProcessed = progress.filesProcessed;
        backupStatus.chunksNew = progress.chunksNew;
        backupStatus.chunksReused = progress.chunksReused;
        backupStatus.bytesProcessed = progress.bytesProcessed;
        backupStatus.bytesCompressed = progress.bytesCompressed;
        backupStatus.bytesStored = progress.bytesStored;
        backupStatus.compressionRatio = progress.compressionRatio;
        backupStatus.errors = progress.errors;
      },
    });

    // Update final status
    backupStatus.running = false;
    backupStatus.phase = 'idle';
    backupStatus.lastRun = new Date().toISOString();
    backupStatus.lastDuration = result.duration;
    backupStatus.currentFile = null;
    backupStatus.errors = result.errors;

    console.log(`[Backup] Complete in ${result.duration}ms - ${result.filesProcessed} files, ${result.chunksNew} new chunks`);

  } catch (err: any) {
    console.error('[Backup] Failed:', err);
    backupStatus.running = false;
    backupStatus.phase = 'idle';
    backupStatus.errors.push(err.message);
  }
}
