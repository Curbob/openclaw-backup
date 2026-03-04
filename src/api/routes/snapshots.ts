import { Router, Request, Response } from 'express';
import { getSnapshots, getSnapshot, deleteSnapshot, getFilesForSnapshot } from '../../core/db.js';

export const snapshotRoutes = Router();

// GET /api/snapshots
snapshotRoutes.get('/', (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 50;
  const snapshots = getSnapshots(limit);
  
  res.json({
    snapshots: snapshots.map(s => ({
      id: s.id,
      timestamp: s.timestamp,
      sourcePath: s.sourcePath,
      totalFiles: s.totalFiles,
      totalBytes: s.totalBytes,
      newChunks: s.newChunks,
      deduplicatedBytes: s.deduplicatedBytes,
      encrypted: s.encrypted,
      destination: s.destinationId,
      label: s.label,
      type: s.type,
    })),
    total: snapshots.length,
  });
});

// GET /api/snapshots/:id
snapshotRoutes.get('/:id', (req: Request, res: Response) => {
  const snapshot = getSnapshot(req.params.id);
  
  if (!snapshot) {
    res.status(404).json({ error: 'Snapshot not found' });
    return;
  }
  
  res.json({
    id: snapshot.id,
    timestamp: snapshot.timestamp,
    sourcePath: snapshot.sourcePath,
    totalFiles: snapshot.totalFiles,
    totalBytes: snapshot.totalBytes,
    newChunks: snapshot.newChunks,
    reusedChunks: snapshot.reusedChunks,
    deduplicatedBytes: snapshot.deduplicatedBytes,
    encrypted: snapshot.encrypted,
    destination: snapshot.destinationId,
    label: snapshot.label,
    type: snapshot.type,
  });
});

// DELETE /api/snapshots/:id
snapshotRoutes.delete('/:id', (req: Request, res: Response) => {
  const deleted = deleteSnapshot(req.params.id);
  
  if (!deleted) {
    res.status(404).json({ error: 'Snapshot not found' });
    return;
  }
  
  res.json({ message: 'Snapshot deleted', id: req.params.id });
});

// GET /api/snapshots/:id/files
snapshotRoutes.get('/:id/files', (req: Request, res: Response) => {
  const snapshot = getSnapshot(req.params.id);
  
  if (!snapshot) {
    res.status(404).json({ error: 'Snapshot not found' });
    return;
  }

  const files = getFilesForSnapshot(req.params.id);
  
  res.json({
    snapshotId: req.params.id,
    files: files.map(f => ({
      path: f.path,
      size: f.size,
      modified: f.modifiedAt,
      chunks: f.chunks.length,
    })),
    total: files.length,
  });
});
