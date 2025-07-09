import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DebtLogs } from './debt_logs.entity';
import { DebtLogsService } from './debt_logs.service';
import { DebtLogsController } from './debt_logs.controller';

@Module({
  imports: [TypeOrmModule.forFeature([DebtLogs])],
  controllers: [DebtLogsController],
  providers: [DebtLogsService],
  exports: [DebtLogsService],
})
export class DebtLogsModule {}
