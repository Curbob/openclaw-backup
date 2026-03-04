/**
 * SQLite database for backup metadata and chunk index
 */

import Database from 'better-sqlite3';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { mkdirSync, existsSync } from 'fs';

// XDG-compliant data directory
const DATA_DIR = process.env.XDG_DATA_HOME
  ? join(process.env.XDG_DATA_HOME, 'openclaw-backup')
  : join(homedir(), '.local', 'share', 'openclaw-backup');

const DB_PATH = join(DATA_DIR, 'backup.db');

let db: Database.Database | null = null;

export interface Snapshot {
  id: string;
  timestamp: string;
  sourcePath: string;
  totalFiles: number;
  totalBytes: number;
  newChunks: number;
  reusedChunks: number;
  deduplicatedBytes: number;
  encrypted: boolean;
  destinationId: string;
  label: string | null;
  type: 'manual' | 'scheduled';
}

export interface Chunk {
  hash: string;           // SHA-256 of content
  size: number;           // Original size
  compressedSize: number; // After compression (if any)
  refCount: number;       // How many files reference this
  destinationId: string;  // Where it's stored
  createdAt: string;
}

export interface FileEntry {
  snapshotId: string;
  path: string;
  rootPath?: string;      // Original source root (for multi-path backups)
  size: number;
  modifiedAt: string;
  mode: number;
  chunks: string[];       // Ordered list of chunk hashes
}

export interface Destination {
  id: string;
  type: 'local' | 'gdrive' | 's3' | 'b2' | 'rclone';
  name: string;
  config: string;         // JSON config
  primary: boolean;
  createdAt: string;
}

export interface Settings {
  key: string;
  value: string;
}

/**
 * Initialize database and create tables
 */
export function initDb(): Database.Database {
  if (db) return db;

  // Ensure data directory exists
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Create tables
  db.exec(`
    -- Snapshots (backup points in time)
    CREATE TABLE IF NOT EXISTS snapshots (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      source_path TEXT NOT NULL,
      total_files INTEGER NOT NULL DEFAULT 0,
      total_bytes INTEGER NOT NULL DEFAULT 0,
      new_chunks INTEGER NOT NULL DEFAULT 0,
      reused_chunks INTEGER NOT NULL DEFAULT 0,
      deduplicated_bytes INTEGER NOT NULL DEFAULT 0,
      encrypted INTEGER NOT NULL DEFAULT 1,
      destination_id TEXT NOT NULL,
      label TEXT,
      type TEXT NOT NULL DEFAULT 'manual',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Content-addressed chunks
    CREATE TABLE IF NOT EXISTS chunks (
      hash TEXT PRIMARY KEY,
      size INTEGER NOT NULL,
      compressed_size INTEGER NOT NULL,
      ref_count INTEGER NOT NULL DEFAULT 1,
      destination_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Files in each snapshot (maps to chunks)
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_id TEXT NOT NULL,
      path TEXT NOT NULL,
      root_path TEXT,
      size INTEGER NOT NULL,
      modified_at TEXT NOT NULL,
      mode INTEGER NOT NULL DEFAULT 420,
      chunks_json TEXT NOT NULL,
      FOREIGN KEY (snapshot_id) REFERENCES snapshots(id) ON DELETE CASCADE,
      UNIQUE(snapshot_id, path, root_path)
    );

    -- Storage destinations
    CREATE TABLE IF NOT EXISTS destinations (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      config_json TEXT NOT NULL DEFAULT '{}',
      is_primary INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Key-value settings
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Indexes for common queries
    CREATE INDEX IF NOT EXISTS idx_snapshots_timestamp ON snapshots(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_files_snapshot ON files(snapshot_id);
    CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);
    CREATE INDEX IF NOT EXISTS idx_chunks_destination ON chunks(destination_id);
  `);

  // Migration: Add root_path column if it doesn't exist (for multi-source backups)
  try {
    db.prepare('SELECT root_path FROM files LIMIT 1').get();
  } catch {
    db.exec('ALTER TABLE files ADD COLUMN root_path TEXT');
  }

  // Insert default local destination if none exists
  const destCount = db.prepare('SELECT COUNT(*) as count FROM destinations').get() as { count: number };
  if (destCount.count === 0) {
    db.prepare(`
      INSERT INTO destinations (id, type, name, config_json, is_primary)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      'local_default',
      'local',
      'Local Backup',
      JSON.stringify({ path: join(DATA_DIR, 'chunks') }),
      1
    );
  }

  return db;
}

/**
 * Get database instance (initializes if needed)
 */
export function getDb(): Database.Database {
  return db || initDb();
}

/**
 * Close database connection
 */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

// ─────────────────────────────────────────────────────────────
// Snapshot operations
// ─────────────────────────────────────────────────────────────

export function createSnapshot(snapshot: Omit<Snapshot, 'id'>): Snapshot {
  const db = getDb();
  const id = `snap_${Date.now().toString(36)}`;
  
  db.prepare(`
    INSERT INTO snapshots (
      id, timestamp, source_path, total_files, total_bytes,
      new_chunks, reused_chunks, deduplicated_bytes, encrypted,
      destination_id, label, type
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    snapshot.timestamp,
    snapshot.sourcePath,
    snapshot.totalFiles,
    snapshot.totalBytes,
    snapshot.newChunks,
    snapshot.reusedChunks,
    snapshot.deduplicatedBytes,
    snapshot.encrypted ? 1 : 0,
    snapshot.destinationId,
    snapshot.label,
    snapshot.type
  );

  return { id, ...snapshot };
}

export function getSnapshots(limit = 50): Snapshot[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM snapshots
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(limit) as any[];

  return rows.map(row => ({
    id: row.id,
    timestamp: row.timestamp,
    sourcePath: row.source_path,
    totalFiles: row.total_files,
    totalBytes: row.total_bytes,
    newChunks: row.new_chunks,
    reusedChunks: row.reused_chunks,
    deduplicatedBytes: row.deduplicated_bytes,
    encrypted: !!row.encrypted,
    destinationId: row.destination_id,
    label: row.label,
    type: row.type,
  }));
}

export function getSnapshot(id: string): Snapshot | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM snapshots WHERE id = ?').get(id) as any;
  
  if (!row) return null;

  return {
    id: row.id,
    timestamp: row.timestamp,
    sourcePath: row.source_path,
    totalFiles: row.total_files,
    totalBytes: row.total_bytes,
    newChunks: row.new_chunks,
    reusedChunks: row.reused_chunks,
    deduplicatedBytes: row.deduplicated_bytes,
    encrypted: !!row.encrypted,
    destinationId: row.destination_id,
    label: row.label,
    type: row.type,
  };
}

export function deleteSnapshot(id: string): boolean {
  const db = getDb();
  
  // Get files to decrement chunk refs
  const files = db.prepare('SELECT chunks_json FROM files WHERE snapshot_id = ?').all(id) as any[];
  
  for (const file of files) {
    const chunks = JSON.parse(file.chunks_json) as string[];
    for (const hash of chunks) {
      db.prepare('UPDATE chunks SET ref_count = ref_count - 1 WHERE hash = ?').run(hash);
    }
  }
  
  // Delete orphaned chunks (ref_count = 0)
  db.prepare('DELETE FROM chunks WHERE ref_count <= 0').run();
  
  // Delete snapshot (cascades to files)
  const result = db.prepare('DELETE FROM snapshots WHERE id = ?').run(id);
  return result.changes > 0;
}

// ─────────────────────────────────────────────────────────────
// Chunk operations
// ─────────────────────────────────────────────────────────────

export function upsertChunk(chunk: Omit<Chunk, 'createdAt'>): { isNew: boolean } {
  const db = getDb();
  
  const existing = db.prepare('SELECT hash FROM chunks WHERE hash = ?').get(chunk.hash);
  
  if (existing) {
    db.prepare('UPDATE chunks SET ref_count = ref_count + 1 WHERE hash = ?').run(chunk.hash);
    return { isNew: false };
  }
  
  db.prepare(`
    INSERT INTO chunks (hash, size, compressed_size, ref_count, destination_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(chunk.hash, chunk.size, chunk.compressedSize, chunk.refCount, chunk.destinationId);
  
  return { isNew: true };
}

export function getChunk(hash: string): Chunk | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM chunks WHERE hash = ?').get(hash) as any;
  
  if (!row) return null;

  return {
    hash: row.hash,
    size: row.size,
    compressedSize: row.compressed_size,
    refCount: row.ref_count,
    destinationId: row.destination_id,
    createdAt: row.created_at,
  };
}

export function chunkExists(hash: string): boolean {
  const db = getDb();
  const row = db.prepare('SELECT 1 FROM chunks WHERE hash = ?').get(hash);
  return !!row;
}

// ─────────────────────────────────────────────────────────────
// File operations
// ─────────────────────────────────────────────────────────────

export function addFile(file: FileEntry): void {
  const db = getDb();
  
  db.prepare(`
    INSERT INTO files (snapshot_id, path, root_path, size, modified_at, mode, chunks_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    file.snapshotId,
    file.path,
    file.rootPath || null,
    file.size,
    file.modifiedAt,
    file.mode,
    JSON.stringify(file.chunks)
  );
}

export function getFilesForSnapshot(snapshotId: string): FileEntry[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM files WHERE snapshot_id = ?').all(snapshotId) as any[];

  return rows.map(row => ({
    snapshotId: row.snapshot_id,
    path: row.path,
    rootPath: row.root_path || undefined,
    size: row.size,
    modifiedAt: row.modified_at,
    mode: row.mode,
    chunks: JSON.parse(row.chunks_json),
  }));
}

// ─────────────────────────────────────────────────────────────
// Destination operations
// ─────────────────────────────────────────────────────────────

export function getDestinations(): Destination[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM destinations ORDER BY is_primary DESC').all() as any[];

  return rows.map(row => ({
    id: row.id,
    type: row.type,
    name: row.name,
    config: row.config_json,
    primary: !!row.is_primary,
    createdAt: row.created_at,
  }));
}

export function getPrimaryDestination(): Destination | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM destinations WHERE is_primary = 1').get() as any;
  
  if (!row) return null;

  return {
    id: row.id,
    type: row.type,
    name: row.name,
    config: row.config_json,
    primary: true,
    createdAt: row.created_at,
  };
}

// ─────────────────────────────────────────────────────────────
// Settings operations
// ─────────────────────────────────────────────────────────────

export function getSetting(key: string): string | null {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

export function getAllSettings(): Record<string, string> {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all() as Settings[];
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

// ─────────────────────────────────────────────────────────────
// Stats
// ─────────────────────────────────────────────────────────────

export interface BackupStats {
  totalSnapshots: number;
  totalChunks: number;
  totalBytes: number;
  deduplicatedBytes: number;
  oldestSnapshot: string | null;
  newestSnapshot: string | null;
}

export function getStats(): BackupStats {
  const db = getDb();
  
  const snapStats = db.prepare(`
    SELECT 
      COUNT(*) as count,
      MIN(timestamp) as oldest,
      MAX(timestamp) as newest
    FROM snapshots
  `).get() as any;
  
  const chunkStats = db.prepare(`
    SELECT 
      COUNT(*) as count,
      COALESCE(SUM(size), 0) as total_bytes,
      COALESCE(SUM(compressed_size), 0) as compressed_bytes
    FROM chunks
  `).get() as any;
  
  const deduped = db.prepare(`
    SELECT COALESCE(SUM(deduplicated_bytes), 0) as total FROM snapshots
  `).get() as any;

  return {
    totalSnapshots: snapStats.count,
    totalChunks: chunkStats.count,
    totalBytes: chunkStats.total_bytes,
    deduplicatedBytes: deduped.total,
    oldestSnapshot: snapStats.oldest,
    newestSnapshot: snapStats.newest,
  };
}
