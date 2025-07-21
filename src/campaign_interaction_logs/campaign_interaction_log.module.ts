import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CampaignInteractionLog } from './campaign_interaction_log.entity';
import { CampaignInteractionLogService } from './campaign_interaction_log.service';
import { CampaignInteractionLogController } from './campaign_interaction_log.controller';

@Module({
  imports: [TypeOrmModule.forFeature([CampaignInteractionLog])],
  providers: [CampaignInteractionLogService],
  controllers: [CampaignInteractionLogController],
})
export class CampaignInteractionLogModule {}
