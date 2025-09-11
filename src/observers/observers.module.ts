import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DebtLogs } from '../debt_logs/debt_logs.entity';
import { DebtConfig } from '../debt_configs/debt_configs.entity';
import { WebsocketModule } from '../websocket/websocket.module';
import { RealTimeDebtObserver } from './realtime-debt.observer';
import { RealTimeCampaignObserver } from './realtime-campaign.observer';
import { DatabaseChangeLog } from './change_log.entity';
import { UserLinkStatusLogObserver } from './user-link-status-log.observer';
import { Debt } from 'src/debts/debt.entity';
import { Campaign } from 'src/campaigns/campaign.entity';
import { CampaignInteractionLog } from 'src/campaign_interaction_logs/campaign_interaction_log.entity';
import { CampaignSchedule } from 'src/campaign_schedules/campaign_schedule.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([DebtLogs, DebtConfig, Debt, Campaign, CampaignInteractionLog, CampaignSchedule, DatabaseChangeLog]), // thêm DatabaseChangeLog vào đây
    WebsocketModule
  ],
  providers: [RealTimeDebtObserver, RealTimeCampaignObserver, UserLinkStatusLogObserver],
  exports: [RealTimeDebtObserver, RealTimeCampaignObserver, UserLinkStatusLogObserver],
})
export class ObserversModule {}