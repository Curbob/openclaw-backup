import { Router, Request, Response } from 'express';

export const snapshotRoutes = Router();

interface Snapshot {
  id: string;
  timestamp: string;
  sourcePath: string;
  totalFiles: number;
  totalBytes: number;
  newChunks: number;
  deduplicatedBytes: number;
  encrypted: boolean;
  destination: string;
}

// Mock data (will come from SQLite)
const mockSnapshots: Snapshot[] = [
  {
    id: 'snap_001',
    timestamp: '2026-03-03T22:00:00Z',
    sourcePath: '/Users/richardcurry/clawd',
    totalFiles: 1247,
    totalBytes: 156_000_000,
    newChunks: 42,
    deduplicatedBytes: 12_000_000,
    encrypted: true,
    destination: 'local:/backups/openclaw',
  },
  {
    id: 'snap_002',
    timestamp: '2026-03-02T22:00:00Z',
    sourcePath: '/Users/richardcurry/clawd',
    totalFiles: 1230,
    totalBytes: 154_500_000,
    newChunks: 89,
    deduplicatedBytes: 8_000_000,
    encrypted: true,
    destination: 'local:/backups/openclaw',
  },
];

// GET /api/snapshots
snapshotRoutes.get('/', (_req: Request, res: Response) => {
  res.json({
    snapshots: mockSnapshots,
    total: mockSnapshots.length,
  });
});

// GET /api/snapshots/:id
snapshotRoutes.get('/:id', (req: Request, res: Response) => {
  const snapshot = mockSnapshots.find(s => s.id === req.params.id);
  if (!snapshot) {
    res.status(404).json({ error: 'Snapshot not found' });
    return;
  }
  res.json(snapshot);
});

// DELETE /api/snapshots/:id
snapshotRoutes.delete('/:id', (req: Request, res: Response) => {
  const index = mockSnapshots.findIndex(s => s.id === req.params.id);
  if (index === -1) {
    res.status(404).json({ error: 'Snapshot not found' });
    return;
  }
  
  // TODO: Actually delete from storage
  mockSnapshots.splice(index, 1);
  res.json({ message: 'Snapshot deleted' });
});

// GET /api/snapshots/:id/files
snapshotRoutes.get('/:id/files', (req: Request, res: Response) => {
  const snapshot = mockSnapshots.find(s => s.id === req.params.id);
  if (!snapshot) {
    res.status(404).json({ error: 'Snapshot not found' });
    return;
  }

  // TODO: Return actual file tree from snapshot
  res.json({
    snapshotId: req.params.id,
    files: [
      { path: 'AGENTS.md', size: 4500, modified: '2026-03-03T21:30:00Z' },
      { path: 'SOUL.md', size: 1200, modified: '2026-03-01T10:00:00Z' },
      { path: 'memory/2026-03-03.md', size: 3200, modified: '2026-03-03T22:00:00Z' },
    ],
  });
});
