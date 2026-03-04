/**
 * Content-Defined Chunking (CDC) for deduplication
 * 
 * Uses FastCDC algorithm to split files into variable-size chunks
 * based on content boundaries, enabling efficient deduplication
 * even when files are modified.
 */

import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';

// Chunk size targets (in bytes)
const MIN_CHUNK = 2 * 1024;        // 2 KB minimum
const AVG_CHUNK = 8 * 1024;        // 8 KB average (good for text files)
const MAX_CHUNK = 64 * 1024;       // 64 KB maximum

// Gear table for rolling hash (FastCDC)
const GEAR_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  GEAR_TABLE[i] = Math.floor(Math.random() * 0xFFFFFFFF);
}

// Mask for determining chunk boundaries
const MASK = (1 << Math.log2(AVG_CHUNK)) - 1;

export interface Chunk {
  hash: string;      // SHA-256 of chunk content
  data: Buffer;      // Raw chunk data
  offset: number;    // Offset in original file
  size: number;      // Chunk size
}

/**
 * Find next chunk boundary using rolling hash
 */
function findBoundary(buffer: Buffer, start: number, end: number): number {
  if (end - start <= MIN_CHUNK) {
    return end;
  }

  let hash = 0;
  const limit = Math.min(start + MAX_CHUNK, end);
  
  // Skip minimum chunk size
  let i = start + MIN_CHUNK;
  
  while (i < limit) {
    hash = (hash << 1) + GEAR_TABLE[buffer[i]];
    if ((hash & MASK) === 0) {
      return i + 1;
    }
    i++;
  }
  
  return limit;
}

/**
 * Hash a chunk using SHA-256
 */
function hashChunk(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Chunk a buffer into content-defined pieces
 */
export function chunkBuffer(buffer: Buffer): Chunk[] {
  const chunks: Chunk[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    const boundary = findBoundary(buffer, offset, buffer.length);
    const data = buffer.subarray(offset, boundary);
    
    chunks.push({
      hash: hashChunk(data),
      data,
      offset,
      size: data.length
    });

    offset = boundary;
  }

  return chunks;
}

/**
 * Chunk a file by streaming (for large files)
 */
export async function chunkFile(filePath: string): Promise<Chunk[]> {
  const fileStats = await stat(filePath);
  
  // For small files, read entire file
  if (fileStats.size <= MAX_CHUNK * 4) {
    const { readFile } = await import('fs/promises');
    const buffer = await readFile(filePath);
    return chunkBuffer(buffer);
  }

  // For large files, stream and chunk
  return new Promise((resolve, reject) => {
    const chunks: Chunk[] = [];
    let buffer = Buffer.alloc(0);
    let globalOffset = 0;

    const stream = createReadStream(filePath, { highWaterMark: MAX_CHUNK * 2 });

    stream.on('data', (data: Buffer) => {
      buffer = Buffer.concat([buffer, data]);

      while (buffer.length >= MAX_CHUNK) {
        const boundary = findBoundary(buffer, 0, buffer.length);
        const chunkData = buffer.subarray(0, boundary);
        
        chunks.push({
          hash: hashChunk(chunkData),
          data: chunkData,
          offset: globalOffset,
          size: chunkData.length
        });

        globalOffset += boundary;
        buffer = buffer.subarray(boundary);
      }
    });

    stream.on('end', () => {
      // Handle remaining data
      if (buffer.length > 0) {
        chunks.push({
          hash: hashChunk(buffer),
          data: buffer,
          offset: globalOffset,
          size: buffer.length
        });
      }
      resolve(chunks);
    });

    stream.on('error', reject);
  });
}

/**
 * Reassemble chunks back into original data
 */
export function reassemble(chunks: Chunk[]): Buffer {
  // Sort by offset to ensure correct order
  const sorted = [...chunks].sort((a, b) => a.offset - b.offset);
  return Buffer.concat(sorted.map(c => c.data));
}
