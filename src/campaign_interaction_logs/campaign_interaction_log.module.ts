import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CampaignInteractionLog } from './campaign_interaction_log.entity';
import { CampaignInteractionLogService } from './campaign_interaction_log.service';
import { CampaignInteractionLogController } from './campaign_interaction_log.controller';
import { Campaign } from '../campaigns/campaign.entity';

@Module({
  imports: [TypeOrmModule.forFeature([CampaignInteractionLog, Campaign])],
  providers: [CampaignInteractionLogService],
  controllers: [CampaignInteractionLogController],
})
export class CampaignInteractionLogModule {}
