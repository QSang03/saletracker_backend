import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DebtLogs } from '../debt_logs/debt_logs.entity';
import { DebtConfig } from '../debt_configs/debt_configs.entity';
import { WebsocketModule } from '../websocket/websocket.module';
import { RealTimeDebtObserver } from './realtime_debt.observer';
import { DatabaseChangeLog } from './change_log.entity';
import { Debt } from 'src/debts/debt.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([DebtLogs, DebtConfig, Debt, DatabaseChangeLog]), // thêm DatabaseChangeLog vào đây
    WebsocketModule
  ],
  providers: [RealTimeDebtObserver],
  exports: [RealTimeDebtObserver],
})
export class ObserversModule {}