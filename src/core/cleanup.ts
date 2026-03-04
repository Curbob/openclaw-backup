/**
 * Cleanup module - finds and removes orphan chunks
 * 
 * Orphan chunks are chunks that exist in storage but aren't
 * referenced by any snapshot. They can occur from:
 * - Deleted snapshots
 * - Failed/interrupted backups
 * - Database corruption
 */

import { getDb, getSnapshots, getFilesForSnapshot } from './db.js';
import { createStorage, StorageBackend } from './storage.js';
import { getPrimaryDestination } from './db.js';

export interface CleanupStats {
  totalChunks: number;
  referencedChunks: number;
  orphanChunks: number;
  orphanBytes: number;
  orphanHashes: string[];
}

export interface CleanupResult extends CleanupStats {
  deletedChunks: number;
  deletedBytes: number;
  errors: string[];
}

export interface CleanupProgress {
  phase: 'scanning-db' | 'scanning-storage' | 'comparing' | 'deleting' | 'complete';
  current: number;
  total: number;
  message: string;
}

export interface CleanupOptions {
  dryRun?: boolean;
  onProgress?: (progress: CleanupProgress) => void;
}

/**
 * Find orphan chunks (chunks not referenced by any file)
 */
export async function findOrphanChunks(
  onProgress?: (progress: CleanupProgress) => void
): Promise<CleanupStats> {
  const emit = (progress: CleanupProgress) => {
    if (onProgress) onProgress(progress);
  };

  // Phase 1: Get all referenced chunks from database
  emit({ phase: 'scanning-db', current: 0, total: 0, message: 'Scanning database...' });
  
  const referencedChunks = new Set<string>();
  const snapshots = getSnapshots(10000); // Get all snapshots
  
  let snapshotIdx = 0;
  for (const snapshot of snapshots) {
    emit({ 
      phase: 'scanning-db', 
      current: ++snapshotIdx, 
      total: snapshots.length, 
      message: `Scanning snapshot ${snapshot.id}` 
    });
    
    const files = getFilesForSnapshot(snapshot.id);
    for (const file of files) {
      for (const hash of file.chunks) {
        referencedChunks.add(hash);
      }
    }
  }

  // Phase 2: Get all chunks from storage
  emit({ phase: 'scanning-storage', current: 0, total: 0, message: 'Scanning storage...' });
  
  const destination = getPrimaryDestination();
  if (!destination) {
    throw new Error('No backup destination configured');
  }
  
  const config = JSON.parse(destination.config);
  const storage = await createStorage(destination.type, config);
  
  const storageChunks = await storage.list();
  
  emit({ 
    phase: 'scanning-storage', 
    current: storageChunks.length, 
    total: storageChunks.length, 
    message: `Found ${storageChunks.length} chunks in storage` 
  });

  // Phase 3: Find orphans
  emit({ phase: 'comparing', current: 0, total: storageChunks.length, message: 'Comparing...' });
  
  const orphanHashes: string[] = [];
  let orphanBytes = 0;
  
  for (let i = 0; i < storageChunks.length; i++) {
    const hash = storageChunks[i];
    
    if (!referencedChunks.has(hash)) {
      orphanHashes.push(hash);
      
      // Try to get size from database first
      const db = getDb();
      const chunk = db.prepare('SELECT size FROM chunks WHERE hash = ?').get(hash) as { size: number } | undefined;
      
      if (chunk) {
        orphanBytes += chunk.size;
      } else {
        // Chunk not in database, estimate by reading from storage
        try {
          const data = await storage.read(hash);
          orphanBytes += data.length;
        } catch {
          // Can't read, skip size estimation
        }
      }
    }
    
    if (i % 100 === 0) {
      emit({ 
        phase: 'comparing', 
        current: i, 
        total: storageChunks.length, 
        message: `Checking ${i}/${storageChunks.length}...` 
      });
    }
  }

  emit({ phase: 'complete', current: 0, total: 0, message: 'Scan complete' });

  return {
    totalChunks: storageChunks.length,
    referencedChunks: referencedChunks.size,
    orphanChunks: orphanHashes.length,
    orphanBytes,
    orphanHashes,
  };
}

/**
 * Clean up orphan chunks
 */
export async function cleanupOrphanChunks(
  options: CleanupOptions = {}
): Promise<CleanupResult> {
  const { dryRun = false, onProgress } = options;
  
  const emit = (progress: CleanupProgress) => {
    if (onProgress) onProgress(progress);
  };

  // Find orphans first
  const stats = await findOrphanChunks(onProgress);
  
  if (dryRun || stats.orphanChunks === 0) {
    return {
      ...stats,
      deletedChunks: 0,
      deletedBytes: 0,
      errors: [],
    };
  }

  // Delete orphan chunks
  emit({ phase: 'deleting', current: 0, total: stats.orphanChunks, message: 'Deleting orphan chunks...' });
  
  const destination = getPrimaryDestination();
  if (!destination) {
    throw new Error('No backup destination configured');
  }
  
  const config = JSON.parse(destination.config);
  const storage = await createStorage(destination.type, config);
  
  const db = getDb();
  let deletedChunks = 0;
  let deletedBytes = 0;
  const errors: string[] = [];

  for (let i = 0; i < stats.orphanHashes.length; i++) {
    const hash = stats.orphanHashes[i];
    
    try {
      // Delete from storage
      await storage.delete(hash);
      
      // Delete from database
      db.prepare('DELETE FROM chunks WHERE hash = ?').run(hash);
      
      deletedChunks++;
      
      // Estimate deleted bytes
      const chunkInfo = db.prepare('SELECT size FROM chunks WHERE hash = ?').get(hash) as { size: number } | undefined;
      if (chunkInfo) {
        deletedBytes += chunkInfo.size;
      }
    } catch (err: any) {
      errors.push(`Failed to delete ${hash}: ${err.message}`);
    }
    
    if (i % 10 === 0) {
      emit({ 
        phase: 'deleting', 
        current: i, 
        total: stats.orphanChunks, 
        message: `Deleted ${deletedChunks} chunks...` 
      });
    }
  }

  emit({ phase: 'complete', current: 0, total: 0, message: `Deleted ${deletedChunks} orphan chunks` });

  return {
    ...stats,
    deletedChunks,
    deletedBytes,
    errors,
  };
}

/**
 * Verify database consistency
 */
export async function verifyIntegrity(): Promise<{
  valid: boolean;
  issues: string[];
  stats: {
    snapshots: number;
    files: number;
    chunks: number;
    missingChunks: number;
  };
}> {
  const db = getDb();
  const issues: string[] = [];
  
  // Count records
  const snapshotCount = (db.prepare('SELECT COUNT(*) as count FROM snapshots').get() as { count: number }).count;
  const fileCount = (db.prepare('SELECT COUNT(*) as count FROM files').get() as { count: number }).count;
  const chunkCount = (db.prepare('SELECT COUNT(*) as count FROM chunks').get() as { count: number }).count;
  
  // Check for files without snapshots
  const orphanFiles = db.prepare(`
    SELECT COUNT(*) as count FROM files f 
    WHERE NOT EXISTS (SELECT 1 FROM snapshots s WHERE s.id = f.snapshot_id)
  `).get() as { count: number };
  
  if (orphanFiles.count > 0) {
    issues.push(`${orphanFiles.count} files reference non-existent snapshots`);
  }
  
  // Check for missing chunks in storage
  const destination = getPrimaryDestination();
  let missingChunks = 0;
  
  if (destination) {
    const config = JSON.parse(destination.config);
    const storage = await createStorage(destination.type, config);
    
    const allChunks = db.prepare('SELECT DISTINCT hash FROM chunks LIMIT 100').all() as { hash: string }[];
    
    for (const { hash } of allChunks) {
      try {
        const exists = await storage.exists(hash);
        if (!exists) {
          missingChunks++;
          issues.push(`Chunk ${hash.substring(0, 16)}... exists in DB but not in storage`);
        }
      } catch {
        // Skip if we can't check
      }
    }
  }
  
  return {
    valid: issues.length === 0,
    issues,
    stats: {
      snapshots: snapshotCount,
      files: fileCount,
      chunks: chunkCount,
      missingChunks,
    },
  };
}
