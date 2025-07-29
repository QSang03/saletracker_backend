import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CampaignCustomer } from './campaign_customer.entity';
import { CampaignCustomerService } from './campaign_customer.service';
import { CampaignCustomerController } from './campaign_customer.controller';
import { CampaignCustomerMap } from '../campaign_customer_map/campaign_customer_map.entity';
import { Campaign } from '../campaigns/campaign.entity';

@Module({
  imports: [TypeOrmModule.forFeature([
    CampaignCustomer, 
    CampaignCustomerMap, 
    Campaign
  ])],
  providers: [CampaignCustomerService],
  controllers: [CampaignCustomerController],
})
export class CampaignCustomerModule {}
