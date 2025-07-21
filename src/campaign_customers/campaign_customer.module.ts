import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CampaignCustomer } from './campaign_customer.entity';
import { CampaignCustomerService } from './campaign_customer.service';
import { CampaignCustomerController } from './campaign_customer.controller';

@Module({
  imports: [TypeOrmModule.forFeature([CampaignCustomer])],
  providers: [CampaignCustomerService],
  controllers: [CampaignCustomerController],
})
export class CampaignCustomerModule {}
