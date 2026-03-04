import { Router, Request, Response } from 'express';
import { createSnapshot, getPrimaryDestination, getStats } from '../../core/db.js';

export const backupRoutes = Router();

interface BackupStatus {
  running: boolean;
  phase: 'idle' | 'scanning' | 'chunking' | 'encrypting' | 'uploading' | 'finalizing';
  lastRun: string | null;
  lastDuration: number | null;
  nextScheduled: string | null;
  currentFile: string | null;
  filesScanned: number;
  filesTotal: number;
  chunksProcessed: number;
  chunksNew: number;
  chunksReused: number;
  bytesProcessed: number;
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
  chunksProcessed: 0,
  chunksNew: 0,
  chunksReused: 0,
  bytesProcessed: 0,
  errors: [],
  startedAt: null,
};

// GET /api/backup/status
backupRoutes.get('/status', (_req: Request, res: Response) => {
  const stats = getStats();
  
  res.json({
    ...backupStatus,
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

  const sourcePath = req.body.sourcePath || process.env.OPENCLAW_WORKSPACE || '~/clawd';
  const label = req.body.label || null;
  
  // Get primary destination
  const destination = getPrimaryDestination();
  if (!destination) {
    res.status(400).json({ error: 'No backup destination configured' });
    return;
  }

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
    chunksProcessed: 0,
    chunksNew: 0,
    chunksReused: 0,
    bytesProcessed: 0,
    errors: [],
    startedAt: new Date().toISOString(),
  };

  console.log(`[Backup] Starting backup of: ${sourcePath}`);

  // TODO: Replace simulation with real backup logic
  // This would call: scanner → chunker → crypto → storage
  runBackupSimulation(sourcePath, label, destination.id);

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

  // TODO: Implement graceful cancellation
  backupStatus.running = false;
  backupStatus.phase = 'idle';
  backupStatus.errors.push('Backup cancelled by user');
  
  res.json({ message: 'Backup cancelled' });
});

// Simulation helper (replace with real implementation)
async function runBackupSimulation(sourcePath: string, label: string | null, destinationId: string) {
  const phases: BackupStatus['phase'][] = ['scanning', 'chunking', 'encrypting', 'uploading', 'finalizing'];
  const totalFiles = 142;
  const totalChunks = 89;
  
  backupStatus.filesTotal = totalFiles;

  for (const phase of phases) {
    if (!backupStatus.running) return;
    
    backupStatus.phase = phase;
    
    if (phase === 'scanning') {
      for (let i = 0; i < totalFiles; i++) {
        if (!backupStatus.running) return;
        backupStatus.filesScanned = i + 1;
        backupStatus.currentFile = `memory/file_${i}.md`;
        await sleep(20);
      }
    } else if (phase === 'chunking') {
      for (let i = 0; i < totalChunks; i++) {
        if (!backupStatus.running) return;
        backupStatus.chunksProcessed = i + 1;
        const isNew = Math.random() > 0.7;
        if (isNew) {
          backupStatus.chunksNew++;
        } else {
          backupStatus.chunksReused++;
        }
        backupStatus.bytesProcessed += Math.floor(Math.random() * 50000) + 10000;
        await sleep(30);
      }
    } else {
      await sleep(500);
    }
  }

  // Create snapshot record
  const startTime = new Date(backupStatus.startedAt!).getTime();
  const duration = Date.now() - startTime;

  createSnapshot({
    timestamp: new Date().toISOString(),
    sourcePath,
    totalFiles: backupStatus.filesScanned,
    totalBytes: backupStatus.bytesProcessed,
    newChunks: backupStatus.chunksNew,
    reusedChunks: backupStatus.chunksReused,
    deduplicatedBytes: backupStatus.chunksReused * 32000, // Estimated
    encrypted: true,
    destinationId,
    label,
    type: 'manual',
  });

  backupStatus.running = false;
  backupStatus.phase = 'idle';
  backupStatus.lastRun = new Date().toISOString();
  backupStatus.lastDuration = duration;
  backupStatus.currentFile = null;

  console.log(`[Backup] Complete in ${duration}ms`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
