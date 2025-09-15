import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

export interface BatchUpdateItem {
  id: string;
  type: string;
  data: any;
  timestamp: number;
  priority: 'high' | 'normal' | 'low';
}

export interface BatchUpdateConfig {
  maxBatchSize: number;
  maxWaitTime: number; // milliseconds
  priorityThresholds: {
    high: number;
    normal: number;
    low: number;
  };
}

@Injectable()
export class BatchUpdateService {
  private readonly logger = new Logger(BatchUpdateService.name);
  private readonly batches: Map<string, BatchUpdateItem[]> = new Map();
  private readonly timers: Map<string, NodeJS.Timeout> = new Map();
  private readonly config: BatchUpdateConfig = {
    maxBatchSize: 50,
    maxWaitTime: 1000, // 1 second
    priorityThresholds: {
      high: 10,
      normal: 25,
      low: 50,
    },
  };

  constructor(private readonly eventEmitter: EventEmitter2) {}

  /**
   * Add item to batch update queue
   */
  addToBatch(
    type: string,
    id: string,
    data: any,
    priority: 'high' | 'normal' | 'low' = 'normal'
  ): void {
    const item: BatchUpdateItem = {
      id,
      type,
      data,
      timestamp: Date.now(),
      priority,
    };

    if (!this.batches.has(type)) {
      this.batches.set(type, []);
    }

    const batch = this.batches.get(type)!;
    batch.push(item);

    // Check if batch should be processed
    this.checkBatchProcessing(type);
  }

  /**
   * Check if batch should be processed based on size or time
   */
  private checkBatchProcessing(type: string): void {
    const batch = this.batches.get(type);
    if (!batch) return;

    const now = Date.now();
    const oldestItem = batch[0];
    const timeSinceOldest = now - oldestItem.timestamp;

    // Process if batch is full or max wait time exceeded
    if (
      batch.length >= this.config.maxBatchSize ||
      timeSinceOldest >= this.config.maxWaitTime
    ) {
      this.processBatch(type);
    } else {
      // Set timer for max wait time
      this.setBatchTimer(type, oldestItem.timestamp);
    }
  }

  /**
   * Set timer for batch processing
   */
  private setBatchTimer(type: string, startTime: number): void {
    // Clear existing timer
    if (this.timers.has(type)) {
      clearTimeout(this.timers.get(type)!);
    }

    const timeElapsed = Date.now() - startTime;
    const remainingTime = Math.max(0, this.config.maxWaitTime - timeElapsed);

    const timer = setTimeout(() => {
      this.processBatch(type);
    }, remainingTime);

    this.timers.set(type, timer);
  }

  /**
   * Process batch of updates
   */
  private async processBatch(type: string): Promise<void> {
    const batch = this.batches.get(type);
    if (!batch || batch.length === 0) return;

    // Clear timer
    if (this.timers.has(type)) {
      clearTimeout(this.timers.get(type)!);
      this.timers.delete(type);
    }

    // Sort by priority and timestamp
    const sortedBatch = this.sortBatchByPriority(batch);

    // Group by priority
    const highPriority = sortedBatch.filter(item => item.priority === 'high');
    const normalPriority = sortedBatch.filter(item => item.priority === 'normal');
    const lowPriority = sortedBatch.filter(item => item.priority === 'low');

    // Process high priority first
    if (highPriority.length > 0) {
      await this.processPriorityBatch(type, highPriority, 'high');
    }

    // Process normal priority
    if (normalPriority.length > 0) {
      await this.processPriorityBatch(type, normalPriority, 'normal');
    }

    // Process low priority
    if (lowPriority.length > 0) {
      await this.processPriorityBatch(type, lowPriority, 'low');
    }

    // Clear the batch
    this.batches.delete(type);
  }

  /**
   * Sort batch by priority and timestamp
   */
  private sortBatchByPriority(batch: BatchUpdateItem[]): BatchUpdateItem[] {
    const priorityOrder = { high: 0, normal: 1, low: 2 };

    return batch.sort((a, b) => {
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return a.timestamp - b.timestamp;
    });
  }

  /**
   * Process batch with specific priority
   */
  private async processPriorityBatch(
    type: string,
    items: BatchUpdateItem[],
    priority: string
  ): Promise<void> {
    try {
      // Emit batch update event
      this.eventEmitter.emit(`batch.${type}.${priority}`, {
        type,
        priority,
        items,
        count: items.length,
        timestamp: Date.now(),
      });

      // Also emit general batch event
      this.eventEmitter.emit('batch.update', {
        type,
        priority,
        items,
        count: items.length,
        timestamp: Date.now(),
      });

    } catch (error) {
      this.logger.error(
        `Error processing batch for ${type} (${priority}):`,
        error
      );
    }
  }

  /**
   * Get current batch status
   */
  getBatchStatus(): Record<string, any> {
    const status: Record<string, any> = {};

    for (const [type, batch] of this.batches.entries()) {
      status[type] = {
        count: batch.length,
        oldestItem: batch[0]?.timestamp,
        age: batch[0] ? Date.now() - batch[0].timestamp : 0,
        priorities: {
          high: batch.filter(item => item.priority === 'high').length,
          normal: batch.filter(item => item.priority === 'normal').length,
          low: batch.filter(item => item.priority === 'low').length,
        },
      };
    }

    return status;
  }

  /**
   * Force process all pending batches
   */
  async forceProcessAll(): Promise<void> {
    const types = Array.from(this.batches.keys());
    
    for (const type of types) {
      await this.processBatch(type);
    }
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<BatchUpdateConfig>): void {
    Object.assign(this.config, newConfig);
  }

  /**
   * Get current configuration
   */
  getConfig(): BatchUpdateConfig {
    return { ...this.config };
  }
}
