import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { RedisService } from '../common/cache/redis.service';
import { Logger } from '@nestjs/common';

async function testRedis() {
  const logger = new Logger('TestRedis');
  
  try {
    logger.log('🚀 Starting Redis test...');
    
    const app = await NestFactory.createApplicationContext(AppModule);
    const redisService = app.get(RedisService);
    
    // Test basic operations
    logger.log('🔧 Testing basic Redis operations...');
    
    // Test ping
    const pingResult = await redisService.ping();
    logger.log(`Ping result: ${pingResult}`);
    
    // Test set/get
    await redisService.set('test_key', { message: 'Hello Redis!', timestamp: new Date() });
    const testValue = await redisService.get('test_key');
    logger.log('Test value retrieved:', testValue);
    
    // Test hash operations
    logger.log('🔧 Testing hash operations...');
    await redisService.hset('test_hash', 'user1', { name: 'John', age: 30 });
    await redisService.hset('test_hash', 'user2', { name: 'Jane', age: 25 });
    
    const user1 = await redisService.hget('test_hash', 'user1');
    logger.log('User1 from hash:', user1);
    
    const allUsers = await redisService.hgetall('test_hash');
    logger.log('All users from hash:', allUsers);
    
    // Test real-time state management
    logger.log('🔧 Testing real-time state management...');
    
    const testEditingUser = {
      userId: 'test_user_1',
      userName: 'Test User',
      socketId: 'socket_123',
      cellId: 'A1',
      startedAt: new Date()
    };
    
    await redisService.setEditingUser('test_user_1', testEditingUser);
    const editingUsers = await redisService.getEditingUsers();
    logger.log('Editing users:', editingUsers);
    
    // Cleanup
    await redisService.del('test_key');
    await redisService.del('test_hash');
    await redisService.removeEditingUser('test_user_1');
    
    logger.log('✅ Redis test completed successfully!');
    await app.close();
  } catch (error) {
    logger.error(`❌ Redis test failed: ${error.message}`);
    process.exit(1);
  }
}

testRedis();
