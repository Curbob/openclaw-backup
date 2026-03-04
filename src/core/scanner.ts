/**
 * File scanner - walks directory tree, respects exclude patterns
 */

import { readdir, stat, readFile } from 'fs/promises';
import { join, relative } from 'path';
import { createHash } from 'crypto';
import { minimatch } from 'minimatch';

export interface FileInfo {
  path: string;           // Relative path from source root
  absolutePath: string;   // Full path for reading
  size: number;
  modifiedAt: Date;
  mode: number;
}

export interface ScanResult {
  files: FileInfo[];
  totalBytes: number;
  skipped: number;
  errors: string[];
}

export interface ScanOptions {
  excludePatterns?: string[];
  maxFileSize?: number;        // Skip files larger than this (bytes)
  followSymlinks?: boolean;
  onProgress?: (current: number, file: string) => void;
}

const DEFAULT_EXCLUDES = [
  'node_modules/',
  'node_modules/**',
  '.git/',
  '.git/**',
  '*.log',
  '.DS_Store',
  'dist/',
  'dist/**',
  '*.tmp',
  '*.swp',
  '.env',
  '.env.*',
  '__pycache__/',
  '__pycache__/**',
  '*.pyc',
  '.venv/',
  '.venv/**',
  'venv/',
  'venv/**',
];

/**
 * Scan a directory for files to backup
 */
export async function scanDirectory(
  sourcePath: string,
  options: ScanOptions = {}
): Promise<ScanResult> {
  const excludePatterns = [...DEFAULT_EXCLUDES, ...(options.excludePatterns || [])];
  const maxFileSize = options.maxFileSize || 100 * 1024 * 1024; // 100MB default
  const followSymlinks = options.followSymlinks ?? false;

  const files: FileInfo[] = [];
  let totalBytes = 0;
  let skipped = 0;
  const errors: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err: any) {
      errors.push(`Cannot read directory ${dir}: ${err.message}`);
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relativePath = relative(sourcePath, fullPath);

      // Check exclude patterns
      if (shouldExclude(relativePath, entry.isDirectory(), excludePatterns)) {
        skipped++;
        continue;
      }

      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() || (followSymlinks && entry.isSymbolicLink())) {
        try {
          const stats = await stat(fullPath);
          
          // Skip files that are too large
          if (stats.size > maxFileSize) {
            skipped++;
            continue;
          }

          const fileInfo: FileInfo = {
            path: relativePath,
            absolutePath: fullPath,
            size: stats.size,
            modifiedAt: stats.mtime,
            mode: stats.mode,
          };

          files.push(fileInfo);
          totalBytes += stats.size;

          if (options.onProgress) {
            options.onProgress(files.length, relativePath);
          }
        } catch (err: any) {
          errors.push(`Cannot stat ${fullPath}: ${err.message}`);
        }
      }
    }
  }

  await walk(sourcePath);

  // Sort files by path for consistent ordering
  files.sort((a, b) => a.path.localeCompare(b.path));

  return { files, totalBytes, skipped, errors };
}

/**
 * Check if a path should be excluded
 */
function shouldExclude(
  relativePath: string,
  isDirectory: boolean,
  patterns: string[]
): boolean {
  const pathToCheck = isDirectory ? relativePath + '/' : relativePath;
  
  for (const pattern of patterns) {
    if (minimatch(pathToCheck, pattern, { dot: true })) {
      return true;
    }
    // Also check without trailing slash for directories
    if (isDirectory && minimatch(relativePath, pattern.replace(/\/$/, ''), { dot: true })) {
      return true;
    }
  }
  
  return false;
}

/**
 * Read a file and return its contents
 */
export async function readFileContent(filePath: string): Promise<Buffer> {
  return readFile(filePath);
}

/**
 * Calculate SHA-256 hash of content
 */
export function hashContent(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}
