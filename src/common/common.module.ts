import { Module } from '@nestjs/common';
import { CacheModule } from './cache/cache.module';
import { CompressionService } from './compression/compression.service';
import { BatchUpdateService } from './batch/batch-update.service';

@Module({
  imports: [CacheModule],
  providers: [CompressionService, BatchUpdateService],
  exports: [CacheModule, CompressionService, BatchUpdateService],
})
export class CommonModule {}
