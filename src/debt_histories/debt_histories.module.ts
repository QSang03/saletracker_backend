import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DebtHistory } from '../debt_histories/debt_histories.entity';
import { DebtHistoryService } from './debt_histories.service';
import { DebtHistoryController } from './debt_histories.controller';

@Module({
  imports: [TypeOrmModule.forFeature([DebtHistory])],
  controllers: [DebtHistoryController],
  providers: [DebtHistoryService],
  exports: [DebtHistoryService],
})
export class DebtHistoriesModule {}
