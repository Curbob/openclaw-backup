/**
 * Storage backends for backup chunks
 */

import { mkdir, writeFile, readFile, unlink, access, readdir } from 'fs/promises';
import { join } from 'path';
import { constants } from 'fs';

export interface StorageBackend {
  type: string;
  
  /** Initialize storage (create dirs, etc.) */
  init(): Promise<void>;
  
  /** Check if a chunk exists */
  exists(hash: string): Promise<boolean>;
  
  /** Write a chunk */
  write(hash: string, data: Buffer): Promise<void>;
  
  /** Read a chunk */
  read(hash: string): Promise<Buffer>;
  
  /** Delete a chunk */
  delete(hash: string): Promise<void>;
  
  /** List all chunk hashes */
  list(): Promise<string[]>;
  
  /** Get storage stats */
  stats(): Promise<{ chunks: number; bytes: number }>;
}

/**
 * Local filesystem storage backend
 * Chunks stored in subdirectories by first 2 chars of hash for performance
 */
export class LocalStorage implements StorageBackend {
  type = 'local';
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  async init(): Promise<void> {
    await mkdir(this.basePath, { recursive: true });
    
    // Create subdirectories for first 2 hex chars (00-ff)
    // This avoids having too many files in one directory
    const hexChars = '0123456789abcdef';
    for (const c1 of hexChars) {
      for (const c2 of hexChars) {
        await mkdir(join(this.basePath, c1 + c2), { recursive: true });
      }
    }
  }

  private chunkPath(hash: string): string {
    const prefix = hash.substring(0, 2);
    return join(this.basePath, prefix, hash);
  }

  async exists(hash: string): Promise<boolean> {
    try {
      await access(this.chunkPath(hash), constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async write(hash: string, data: Buffer): Promise<void> {
    const path = this.chunkPath(hash);
    await writeFile(path, data);
  }

  async read(hash: string): Promise<Buffer> {
    return readFile(this.chunkPath(hash));
  }

  async delete(hash: string): Promise<void> {
    try {
      await unlink(this.chunkPath(hash));
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  async list(): Promise<string[]> {
    const hashes: string[] = [];
    
    const prefixes = await readdir(this.basePath);
    for (const prefix of prefixes) {
      if (prefix.length !== 2) continue;
      
      try {
        const files = await readdir(join(this.basePath, prefix));
        hashes.push(...files);
      } catch {
        // Skip unreadable directories
      }
    }
    
    return hashes;
  }

  async stats(): Promise<{ chunks: number; bytes: number }> {
    const hashes = await this.list();
    let bytes = 0;
    
    for (const hash of hashes) {
      try {
        const data = await this.read(hash);
        bytes += data.length;
      } catch {
        // Skip unreadable chunks
      }
    }
    
    return { chunks: hashes.length, bytes };
  }
}

/**
 * Create storage backend from destination config
 */
export async function createStorage(type: string, config: any): Promise<StorageBackend> {
  switch (type) {
    case 'local':
      return new LocalStorage(config.path);
    
    case 'gdrive': {
      const { GoogleDriveStorage } = await import('./gdrive.js');
      return new GoogleDriveStorage(config);
    }
    
    // TODO: Add more backends
    // case 's3':
    //   return new S3Storage(config);
    
    default:
      throw new Error(`Unknown storage type: ${type}`);
  }
}
