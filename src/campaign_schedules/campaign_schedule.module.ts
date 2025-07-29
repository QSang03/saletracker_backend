import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CampaignSchedule } from './campaign_schedule.entity';
import { CampaignScheduleService } from './campaign_schedule.service';
import { CampaignScheduleController } from './campaign_schedule.controller';
import { Campaign } from '../campaigns/campaign.entity';

@Module({
  imports: [TypeOrmModule.forFeature([CampaignSchedule, Campaign])],
  providers: [CampaignScheduleService],
  controllers: [CampaignScheduleController],
})
export class CampaignScheduleModule {}
