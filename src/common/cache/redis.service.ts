import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly redis: Redis;
  private readonly logger = new Logger(RedisService.name);

  constructor() {
    // Enable Redis for real-time state management
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      keepAlive: 30000,
    });

    this.redis.on('connect', () => {
      this.logger.log('✅ Redis connected successfully');
    });

    this.redis.on('error', (error) => {
      this.logger.error('❌ Redis connection error:', error);
    });

    this.redis.on('close', () => {
      this.logger.warn('⚠️ Redis connection closed');
    });
  }

  // ✅ THÊM: Hàm helper để xử lý encoding cho Unicode
  private serializeForRedis(value: any): string {
    // Sử dụng Buffer để đảm bảo Unicode được xử lý đúng
    const jsonString = JSON.stringify(value);
    return Buffer.from(jsonString, 'utf8').toString('utf8');
  }

  private deserializeFromRedis(value: string): any {
    // Sử dụng Buffer để đảm bảo Unicode được xử lý đúng
    const utf8String = Buffer.from(value, 'utf8').toString('utf8');
    return JSON.parse(utf8String);
  }

  // Basic cache operations
  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await this.redis.get(key);
      return value ? this.deserializeFromRedis(value) : null;
    } catch (error) {
      this.logger.error(`Error getting key ${key}:`, error);
      return null;
    }
  }

  async set(key: string, value: any, ttl?: number): Promise<void> {
    try {
      const serializedValue = this.serializeForRedis(value);
      if (ttl) {
        await this.redis.setex(key, ttl, serializedValue);
      } else {
        await this.redis.set(key, serializedValue);
      }
    } catch (error) {
      this.logger.error(`Error setting key ${key}:`, error);
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (error) {
      this.logger.error(`Error deleting key ${key}:`, error);
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const result = await this.redis.exists(key);
      return result === 1;
    } catch (error) {
      this.logger.error(`Error checking key ${key}:`, error);
      return false;
    }
  }

  // Hash operations for complex data
  async hget<T>(key: string, field: string): Promise<T | null> {
    try {
      const value = await this.redis.hget(key, field);
      return value ? this.deserializeFromRedis(value) : null;
    } catch (error) {
      this.logger.error(`Error getting hash field ${key}:${field}:`, error);
      return null;
    }
  }

  async hset(key: string, field: string, value: any): Promise<void> {
    try {
      await this.redis.hset(key, field, this.serializeForRedis(value));
    } catch (error) {
      this.logger.error(`Error setting hash field ${key}:${field}:`, error);
    }
  }

  async hgetall<T>(key: string): Promise<Record<string, T> | null> {
    try {
      const result = await this.redis.hgetall(key);
      if (!result || Object.keys(result).length === 0) {
        return null;
      }
      const parsed: Record<string, T> = {};
      for (const [field, value] of Object.entries(result)) {
        parsed[field] = JSON.parse(value);
      }
      return parsed;
    } catch (error) {
      this.logger.error(`Error getting hash ${key}:`, error);
      return null;
    }
  }

  // List operations
  async lpush(key: string, value: any): Promise<void> {
    try {
      await this.redis.lpush(key, JSON.stringify(value));
    } catch (error) {
      this.logger.error(`Error pushing to list ${key}:`, error);
    }
  }

  async lrange<T>(key: string, start: number, stop: number): Promise<T[]> {
    try {
      const result = await this.redis.lrange(key, start, stop);
      return result.map(item => JSON.parse(item));
    } catch (error) {
      this.logger.error(`Error getting range from list ${key}:`, error);
      return [];
    }
  }

  // Cache patterns
  async getOrSet<T>(
    key: string, 
    factory: () => Promise<T>, 
    ttl: number = 300
  ): Promise<T> {
    try {
      const cached = await this.get<T>(key);
      if (cached !== null) {
        return cached;
      }
      const fresh = await factory();
      await this.set(key, fresh, ttl);
      return fresh;
    } catch (error) {
      this.logger.error(`Error in getOrSet for key ${key}:`, error);
      return await factory();
    }
  }

  // Batch operations
  async mget<T>(keys: string[]): Promise<(T | null)[]> {
    try {
      const values = await this.redis.mget(...keys);
      return values.map(value => value ? JSON.parse(value) : null);
    } catch (error) {
      this.logger.error('Error in mget:', error);
      return keys.map(() => null);
    }
  }

  async mset(keyValues: Record<string, any>, ttl?: number): Promise<void> {
    try {
      const serialized: Record<string, string> = {};
      for (const [key, value] of Object.entries(keyValues)) {
        serialized[key] = JSON.stringify(value);
      }
      await this.redis.mset(serialized);
      if (ttl) {
        for (const key of Object.keys(keyValues)) {
          await this.redis.expire(key, ttl);
        }
      }
    } catch (error) {
      this.logger.error('Error in mset:', error);
    }
  }

  // Cache invalidation patterns
  async invalidatePattern(pattern: string): Promise<void> {
    try {
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } catch (error) {
      this.logger.error(`Error invalidating pattern ${pattern}:`, error);
    }
  }

  // Health check
  async ping(): Promise<boolean> {
    try {
      const result = await this.redis.ping();
      return result === 'PONG';
    } catch (error) {
      this.logger.error('Redis ping failed:', error);
      return false;
    }
  }

  // Get Redis instance for advanced operations
  getClient(): Redis {
    return this.redis;
  }

  // Cleanup on module destroy
  async onModuleDestroy() {
    try {
      await this.redis.quit();
      this.logger.log('Redis connection closed');
    } catch (error) {
      this.logger.error('Error closing Redis connection:', error);
    }
  }

  // Real-time state management for editing users
  async getEditingUsers(): Promise<any[]> {
    try {
      const users = await this.hgetall('editing_users');
      return users ? Object.values(users) : [];
    } catch (error) {
      this.logger.error('Error getting editing users:', error);
      return [];
    }
  }

  async setEditingUser(userId: string, userData: any): Promise<void> {
    try {
      await this.hset('editing_users', userId, userData);
      // Set expiry for 1 hour
      await this.redis.expire('editing_users', 3600);
    } catch (error) {
      this.logger.error(`Error setting editing user ${userId}:`, error);
    }
  }

  async removeEditingUser(userId: string): Promise<void> {
    try {
      await this.redis.hdel('editing_users', userId);
    } catch (error) {
      this.logger.error(`Error removing editing user ${userId}:`, error);
    }
  }

  async getCampaignScheduleUsers(): Promise<any[]> {
    try {
      const users = await this.hgetall('campaign_schedule_users');
      return users ? Object.values(users) : [];
    } catch (error) {
      this.logger.error('Error getting campaign schedule users:', error);
      return [];
    }
  }

  async setCampaignScheduleUser(userId: string, userData: any): Promise<void> {
    try {
      await this.hset('campaign_schedule_users', userId, userData);
      // Set expiry for 1 hour
      await this.redis.expire('campaign_schedule_users', 3600);
    } catch (error) {
      this.logger.error(`Error setting campaign schedule user ${userId}:`, error);
    }
  }

  async removeCampaignScheduleUser(userId: string): Promise<void> {
    try {
      await this.redis.hdel('campaign_schedule_users', userId);
    } catch (error) {
      this.logger.error(`Error removing campaign schedule user ${userId}:`, error);
    }
  }

  // Cell selection management for schedule collaboration
  async getCellSelections(roomId: string = 'default'): Promise<Record<string, any>> {
    try {
      const selections = await this.hgetall(`sched:cellSelections:${roomId}`);
      return selections || {};
    } catch (error) {
      this.logger.error('Error getting cell selections:', error);
      return {};
    }
  }

  async setCellSelections(userId: string, selections: any, roomId: string): Promise<void> {
    const key = `sched:cellSelections:${roomId}`;
    const dataToStore = { ...selections, userId, updatedAt: new Date().toISOString() };
    await this.hset(key, `user:${userId}`, dataToStore);     // ✅ SỬA: Sử dụng helper function để xử lý Unicode
    await this.getClient().expire(key, 1800);
  }

  async removeCellSelections(userId: string, roomId: string): Promise<void> {
    await this.getClient().hdel(`sched:cellSelections:${roomId}`, `user:${userId}`);
  }

  async getAllCellSelections(roomId: string): Promise<Array<{ userId: string; selections: any }>> {
    const key = `sched:cellSelections:${roomId}`;
    const obj = await this.hgetall<any>(key);                 // 👈 wrapper parse sẵn
    if (!obj) return [];
    return Object.entries(obj).map(([field, selections]) => ({
      userId: field.replace('user:', ''),
      selections,                                            // 👈 là OBJECT thật
    }));
  }

  async getCellSelectionByUser(userId: string, roomId: string = 'default'): Promise<any | null> {
    try {
      return await this.hget(`sched:cellSelections:${roomId}`, `user:${userId}`); // object hoặc null
    } catch (error) {
      this.logger.error(`Error getting cell selections for user ${userId}:`, error);
      return null;
    }
  }
}
