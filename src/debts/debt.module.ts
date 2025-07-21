import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Debt } from './debt.entity';
import { DebtService } from './debt.service';
import { DebtController } from './debt.controller';
import { DebtConfig } from '../debt_configs/debt_configs.entity';
import { User } from '../users/user.entity';
import { DebtStatistic } from 'src/debt_statistics/debt_statistic.entity';
import { DebtImportBackup } from './debt_import_backups.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Debt, DebtConfig, User, DebtStatistic, DebtImportBackup])],
  controllers: [DebtController],
  providers: [DebtService],
  exports: [DebtService],
})
export class DebtModule {}
