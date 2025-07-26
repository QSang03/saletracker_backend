import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { HttpModule } from '@nestjs/axios';
import { CronjobService } from '../cronjobs/cronjob.service';
import { NKCProduct } from '../nkc_products/nkc_product.entity';
import { Category } from '../categories/category.entity';
import { DebtStatistic } from '../debt_statistics/debt_statistic.entity';
import { Debt } from '../debts/debt.entity';
import { DebtHistory } from 'src/debt_histories/debt_histories.entity';
import { DatabaseChangeLog } from 'src/observers/change_log.entity';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    HttpModule,
    TypeOrmModule.forFeature([NKCProduct, Category, DebtStatistic, Debt, DebtHistory, DatabaseChangeLog]),
  ],
  providers: [CronjobService],
  exports: [CronjobService],
})
export class CronjobModule {}
