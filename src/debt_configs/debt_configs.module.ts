import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DebtConfig } from './debt_configs.entity';
import { DebtConfigService } from './debt_configs.service';
import { DebtConfigController } from './debt_configs.controller';
import { Debt } from '../debts/debt.entity';
import { DebtLogs } from '../debt_logs/debt_logs.entity';
import { User } from '../users/user.entity';
import { DebtLogsService } from '../debt_logs/debt_logs.service';

@Module({
  imports: [TypeOrmModule.forFeature([DebtConfig, Debt, DebtLogs, User])],
  controllers: [DebtConfigController],
  providers: [DebtConfigService, DebtLogsService],
  exports: [DebtConfigService],
})
export class DebtConfigsModule {}
