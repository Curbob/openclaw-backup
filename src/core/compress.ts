/**
 * Compression module using zlib
 * 
 * Compresses chunks before encryption to reduce storage space.
 * Uses gzip for good balance of speed and compression ratio.
 */

import { gzip, gunzip } from 'zlib';
import { promisify } from 'util';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

// Compression levels (1-9, higher = better compression but slower)
const COMPRESSION_LEVEL = 6; // Default, good balance

// Minimum size to compress (tiny files may get larger after compression)
const MIN_COMPRESS_SIZE = 64;

// Magic bytes to identify compressed data
const GZIP_MAGIC = Buffer.from([0x1f, 0x8b]);

export interface CompressionResult {
  data: Buffer;
  originalSize: number;
  compressedSize: number;
  ratio: number;           // compression ratio (0-1, lower is better)
  compressed: boolean;     // whether compression was actually applied
}

/**
 * Compress data using gzip
 * 
 * Returns original data if:
 * - Data is too small to benefit from compression
 * - Compressed data would be larger than original
 */
export async function compress(data: Buffer): Promise<CompressionResult> {
  const originalSize = data.length;
  
  // Skip compression for tiny data
  if (originalSize < MIN_COMPRESS_SIZE) {
    return {
      data,
      originalSize,
      compressedSize: originalSize,
      ratio: 1,
      compressed: false,
    };
  }

  try {
    const compressed = await gzipAsync(data, { level: COMPRESSION_LEVEL });
    
    // Only use compressed version if it's actually smaller
    if (compressed.length < originalSize) {
      return {
        data: compressed,
        originalSize,
        compressedSize: compressed.length,
        ratio: compressed.length / originalSize,
        compressed: true,
      };
    }
    
    // Compression made it larger (already compressed data, random data, etc.)
    return {
      data,
      originalSize,
      compressedSize: originalSize,
      ratio: 1,
      compressed: false,
    };
  } catch (err) {
    // If compression fails, return original
    return {
      data,
      originalSize,
      compressedSize: originalSize,
      ratio: 1,
      compressed: false,
    };
  }
}

/**
 * Decompress gzip data
 * 
 * Automatically detects if data is compressed by checking magic bytes.
 */
export async function decompress(data: Buffer): Promise<Buffer> {
  // Check for gzip magic bytes
  if (isCompressed(data)) {
    try {
      return await gunzipAsync(data);
    } catch (err) {
      // If decompression fails, data might not actually be compressed
      // or might be corrupted - return as-is
      throw new Error(`Decompression failed: ${(err as Error).message}`);
    }
  }
  
  // Not compressed, return as-is
  return data;
}

/**
 * Check if data appears to be gzip compressed
 */
export function isCompressed(data: Buffer): boolean {
  if (data.length < 2) return false;
  return data[0] === GZIP_MAGIC[0] && data[1] === GZIP_MAGIC[1];
}

/**
 * Get compression statistics for a set of results
 */
export function compressionStats(results: CompressionResult[]): {
  totalOriginal: number;
  totalCompressed: number;
  overallRatio: number;
  compressedCount: number;
  uncompressedCount: number;
  savedBytes: number;
} {
  let totalOriginal = 0;
  let totalCompressed = 0;
  let compressedCount = 0;
  let uncompressedCount = 0;

  for (const result of results) {
    totalOriginal += result.originalSize;
    totalCompressed += result.compressedSize;
    if (result.compressed) {
      compressedCount++;
    } else {
      uncompressedCount++;
    }
  }

  return {
    totalOriginal,
    totalCompressed,
    overallRatio: totalOriginal > 0 ? totalCompressed / totalOriginal : 1,
    compressedCount,
    uncompressedCount,
    savedBytes: totalOriginal - totalCompressed,
  };
}
