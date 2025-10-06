import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SendHistory } from './send_history.entity';
import { SendHistoryService } from './send_history.service';
import { SendHistoryController } from './send_history.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([SendHistory]), AuthModule],
  providers: [SendHistoryService],
  controllers: [SendHistoryController],
  exports: [SendHistoryService],
})
export class SendHistoryModule {}
