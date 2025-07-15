import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DebtStatisticService } from './debt_statistic.service';
import { DebtStatisticController } from './debt_statistic.controller';
import { DebtStatistic } from './debt_statistic.entity';
import { Debt } from '../debts/debt.entity';
import { CronjobModule } from '../cronjobs/cronjob.module';
import { UserModule } from '../users/user.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([DebtStatistic, Debt]),
    CronjobModule,
    UserModule,
  ],
  controllers: [DebtStatisticController],
  providers: [DebtStatisticService],
  exports: [DebtStatisticService],
})
export class DebtStatisticModule {}
