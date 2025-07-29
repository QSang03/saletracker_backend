import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Campaign } from './campaign.entity';
import { CampaignService } from './campaign.service';
import { CampaignController } from './campaign.controller';
import { CampaignCustomerMap } from '../campaign_customer_map/campaign_customer_map.entity';
import { CampaignInteractionLog } from '../campaign_interaction_logs/campaign_interaction_log.entity';
import { CampaignContent } from 'src/campaign_contents/campaign_content.entity';
import { CampaignSchedule } from 'src/campaign_schedules/campaign_schedule.entity';
import { CampaignEmailReport } from 'src/campaign_email_reports/campaign_email_report.entity';
import { CampaignCustomer } from 'src/campaign_customers/campaign_customer.entity';

@Module({
  imports: [TypeOrmModule.forFeature([
    Campaign, 
    CampaignContent,
    CampaignSchedule,
    CampaignEmailReport,
    CampaignCustomerMap, 
    CampaignCustomer,
    CampaignInteractionLog
  ])],
  providers: [CampaignService],
  controllers: [CampaignController],
})
export class CampaignModule {}
