/**
 * Backup engine - orchestrates scanning, chunking, encryption, and storage
 */

import { scanDirectory, readFileContent, hashContent, FileInfo, ScanOptions } from './scanner.js';
import { chunkBuffer } from './chunker.js';
import { encrypt, decrypt, deriveKey } from './crypto.js';
import { createStorage, StorageBackend } from './storage.js';
import { 
  createSnapshot, 
  addFile, 
  upsertChunk, 
  getSetting, 
  setSetting,
  getPrimaryDestination,
  getFilesForSnapshot,
  getChunk,
  Snapshot,
} from './db.js';

export interface BackupProgress {
  phase: 'scanning' | 'processing' | 'finalizing';
  currentFile: string | null;
  filesScanned: number;
  filesTotal: number;
  filesProcessed: number;
  chunksNew: number;
  chunksReused: number;
  bytesProcessed: number;
  bytesStored: number;
  errors: string[];
}

export interface BackupOptions {
  sourcePath: string;
  label?: string;
  excludePatterns?: string[];
  onProgress?: (progress: BackupProgress) => void;
}

export interface BackupResult {
  snapshot: Snapshot;
  filesProcessed: number;
  chunksNew: number;
  chunksReused: number;
  bytesProcessed: number;
  bytesStored: number;
  deduplicatedBytes: number;
  duration: number;
  errors: string[];
}

/**
 * Run a backup
 */
export async function runBackup(options: BackupOptions): Promise<BackupResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  
  // Get encryption key
  const encryptionKey = await getEncryptionKey();
  if (!encryptionKey) {
    throw new Error('Encryption not configured. Run init first.');
  }

  // Get storage backend
  const destination = getPrimaryDestination();
  if (!destination) {
    throw new Error('No backup destination configured');
  }
  
  const config = JSON.parse(destination.config);
  const storage = await createStorage(destination.type, config);
  await storage.init();

  // Progress tracking
  const progress: BackupProgress = {
    phase: 'scanning',
    currentFile: null,
    filesScanned: 0,
    filesTotal: 0,
    filesProcessed: 0,
    chunksNew: 0,
    chunksReused: 0,
    bytesProcessed: 0,
    bytesStored: 0,
    errors: [],
  };

  const emitProgress = () => {
    if (options.onProgress) {
      options.onProgress({ ...progress });
    }
  };

  // Phase 1: Scan files
  const scanResult = await scanDirectory(options.sourcePath, {
    excludePatterns: options.excludePatterns,
    onProgress: (count, file) => {
      progress.filesScanned = count;
      progress.currentFile = file;
      emitProgress();
    },
  });

  progress.filesTotal = scanResult.files.length;
  errors.push(...scanResult.errors);

  // Phase 2: Process files
  progress.phase = 'processing';
  emitProgress();

  const fileChunks: Map<string, string[]> = new Map();
  let totalBytesStored = 0;
  let deduplicatedBytes = 0;

  for (const file of scanResult.files) {
    progress.currentFile = file.path;
    emitProgress();

    try {
      // Read file content
      const content = await readFileContent(file.absolutePath);
      progress.bytesProcessed += content.length;

      // Chunk the file
      const chunks = chunkBuffer(content);
      const chunkHashes: string[] = [];

      for (const chunk of chunks) {
        // Use the pre-computed hash from the chunk
        const hash = chunk.hash;
        chunkHashes.push(hash);

        // Check if chunk already exists
        const exists = await storage.exists(hash);
        
        if (exists) {
          // Deduplicated - just increment ref count
          upsertChunk({
            hash,
            size: chunk.size,
            compressedSize: chunk.size, // TODO: Add compression
            refCount: 1,
            destinationId: destination.id,
          });
          progress.chunksReused++;
          deduplicatedBytes += chunk.size;
        } else {
          // New chunk - encrypt and store
          const encrypted = encrypt(chunk.data, encryptionKey);
          await storage.write(hash, encrypted);
          
          upsertChunk({
            hash,
            size: chunk.size,
            compressedSize: encrypted.length,
            refCount: 1,
            destinationId: destination.id,
          });
          
          progress.chunksNew++;
          totalBytesStored += encrypted.length;
        }
      }

      fileChunks.set(file.path, chunkHashes);
      progress.filesProcessed++;
      emitProgress();

    } catch (err: any) {
      errors.push(`Failed to process ${file.path}: ${err.message}`);
    }
  }

  // Phase 3: Finalize - create snapshot record
  progress.phase = 'finalizing';
  progress.currentFile = null;
  emitProgress();

  const snapshot = createSnapshot({
    timestamp: new Date().toISOString(),
    sourcePath: options.sourcePath,
    totalFiles: progress.filesProcessed,
    totalBytes: progress.bytesProcessed,
    newChunks: progress.chunksNew,
    reusedChunks: progress.chunksReused,
    deduplicatedBytes,
    encrypted: true,
    destinationId: destination.id,
    label: options.label || null,
    type: 'manual',
  });

  // Add file records
  for (const file of scanResult.files) {
    const chunks = fileChunks.get(file.path);
    if (chunks) {
      addFile({
        snapshotId: snapshot.id,
        path: file.path,
        size: file.size,
        modifiedAt: file.modifiedAt.toISOString(),
        mode: file.mode,
        chunks,
      });
    }
  }

  progress.errors = errors;
  emitProgress();

  return {
    snapshot,
    filesProcessed: progress.filesProcessed,
    chunksNew: progress.chunksNew,
    chunksReused: progress.chunksReused,
    bytesProcessed: progress.bytesProcessed,
    bytesStored: totalBytesStored,
    deduplicatedBytes,
    duration: Date.now() - startTime,
    errors,
  };
}

/**
 * Get or prompt for encryption key
 */
async function getEncryptionKey(): Promise<Buffer | null> {
  const saltBase64 = getSetting('encryptionSalt');
  const passwordHash = getSetting('encryptionPasswordHash');
  
  if (!saltBase64 || !passwordHash) {
    return null;
  }

  // For now, we store a derived key directly (in production, prompt for password)
  const keyBase64 = getSetting('encryptionKey');
  if (keyBase64) {
    return Buffer.from(keyBase64, 'base64');
  }

  return null;
}

/**
 * Initialize encryption with a password
 */
export async function initEncryption(password: string): Promise<void> {
  const { key, salt } = deriveKey(password);
  
  // Store salt and derived key
  setSetting('encryptionSalt', salt.toString('base64'));
  setSetting('encryptionKey', key.toString('base64'));
  
  // Store hash of password for verification (not the password itself)
  const verificationHash = hashContent(Buffer.from(password + salt.toString('base64')));
  setSetting('encryptionPasswordHash', verificationHash);
}

/**
 * Check if encryption is configured
 */
export function isEncryptionConfigured(): boolean {
  return getSetting('encryptionKey') !== null;
}

// ─────────────────────────────────────────────────────────────
// Restore
// ─────────────────────────────────────────────────────────────

export interface RestoreProgress {
  phase: 'preparing' | 'downloading' | 'decrypting' | 'writing';
  currentFile: string | null;
  filesTotal: number;
  filesRestored: number;
  bytesRestored: number;
  errors: string[];
}

export interface RestoreOptions {
  snapshotId: string;
  targetPath?: string;           // If null, restore to original locations
  files?: string[];              // Specific files to restore (null = all)
  onProgress?: (progress: RestoreProgress) => void;
}

export interface RestoreResult {
  filesRestored: number;
  bytesRestored: number;
  duration: number;
  errors: string[];
}

/**
 * Restore files from a snapshot
 */
export async function runRestore(options: RestoreOptions): Promise<RestoreResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  
  // Get encryption key
  const encryptionKey = await getEncryptionKey();
  if (!encryptionKey) {
    throw new Error('Encryption key not available');
  }

  // Get storage backend
  const destination = getPrimaryDestination();
  if (!destination) {
    throw new Error('No backup destination configured');
  }
  
  const config = JSON.parse(destination.config);
  const storage = await createStorage(destination.type, config);

  // Get files from snapshot
  let files = getFilesForSnapshot(options.snapshotId);
  
  // Filter to specific files if requested
  if (options.files && options.files.length > 0) {
    const fileSet = new Set(options.files);
    files = files.filter(f => fileSet.has(f.path));
  }

  const progress: RestoreProgress = {
    phase: 'preparing',
    currentFile: null,
    filesTotal: files.length,
    filesRestored: 0,
    bytesRestored: 0,
    errors: [],
  };

  const emitProgress = () => {
    if (options.onProgress) {
      options.onProgress({ ...progress });
    }
  };

  emitProgress();

  // Import fs functions
  const { writeFile, mkdir } = await import('fs/promises');
  const { dirname, join } = await import('path');

  progress.phase = 'downloading';
  emitProgress();

  for (const file of files) {
    progress.currentFile = file.path;
    emitProgress();

    try {
      // Reassemble file from chunks
      const chunks: Buffer[] = [];
      
      progress.phase = 'downloading';
      for (const hash of file.chunks) {
        const encryptedChunk = await storage.read(hash);
        
        progress.phase = 'decrypting';
        const decryptedChunk = await decrypt(encryptedChunk, encryptionKey);
        chunks.push(decryptedChunk);
      }

      const content = Buffer.concat(chunks);

      // Determine output path
      progress.phase = 'writing';
      const outputPath = options.targetPath 
        ? join(options.targetPath, file.path)
        : file.path; // Original path (relative to source)

      // Ensure directory exists
      await mkdir(dirname(outputPath), { recursive: true });

      // Write file
      await writeFile(outputPath, content, { mode: file.mode });

      progress.filesRestored++;
      progress.bytesRestored += content.length;
      emitProgress();

    } catch (err: any) {
      errors.push(`Failed to restore ${file.path}: ${err.message}`);
    }
  }

  progress.phase = 'writing';
  progress.currentFile = null;
  progress.errors = errors;
  emitProgress();

  return {
    filesRestored: progress.filesRestored,
    bytesRestored: progress.bytesRestored,
    duration: Date.now() - startTime,
    errors,
  };
}
