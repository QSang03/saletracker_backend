import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CampaignSchedule } from './campaign_schedule.entity';
import { CampaignScheduleService } from './campaign_schedule.service';
import { CampaignScheduleController } from './campaign_schedule.controller';

@Module({
  imports: [TypeOrmModule.forFeature([CampaignSchedule])],
  providers: [CampaignScheduleService],
  controllers: [CampaignScheduleController],
})
export class CampaignScheduleModule {}
