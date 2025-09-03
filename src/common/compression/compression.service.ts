import { Injectable } from '@nestjs/common';
import * as zlib from 'zlib';
import { promisify } from 'util';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

@Injectable()
export class CompressionService {
  /**
   * Compress data using gzip
   */
  async compress(data: any): Promise<Buffer> {
    try {
      const jsonString = JSON.stringify(data);
      const compressed = await gzip(jsonString);
      return compressed;
    } catch (error) {
      throw new Error(`Compression failed: ${error.message}`);
    }
  }

  /**
   * Decompress data using gzip
   */
  async decompress(compressedData: Buffer): Promise<any> {
    try {
      const decompressed = await gunzip(compressedData);
      const jsonString = decompressed.toString('utf8');
      return JSON.parse(jsonString);
    } catch (error) {
      throw new Error(`Decompression failed: ${error.message}`);
    }
  }

  /**
   * Compress data if it's larger than threshold
   */
  async compressIfNeeded(data: any, threshold: number = 1024): Promise<{
    data: any;
    compressed: boolean;
    originalSize: number;
    compressedSize: number;
  }> {
    const jsonString = JSON.stringify(data);
    const originalSize = Buffer.byteLength(jsonString, 'utf8');

    if (originalSize <= threshold) {
      return {
        data,
        compressed: false,
        originalSize,
        compressedSize: originalSize,
      };
    }

    const compressed = await this.compress(data);
    const compressedSize = compressed.length;

    return {
      data: compressed,
      compressed: true,
      originalSize,
      compressedSize,
    };
  }

  /**
   * Batch compress multiple items
   */
  async batchCompress(items: any[]): Promise<Buffer[]> {
    const promises = items.map(item => this.compress(item));
    return Promise.all(promises);
  }

  /**
   * Batch decompress multiple items
   */
  async batchDecompress(compressedItems: Buffer[]): Promise<any[]> {
    const promises = compressedItems.map(item => this.decompress(item));
    return Promise.all(promises);
  }

  /**
   * Get compression ratio
   */
  getCompressionRatio(originalSize: number, compressedSize: number): number {
    return ((originalSize - compressedSize) / originalSize) * 100;
  }
}
