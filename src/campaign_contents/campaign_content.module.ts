import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CampaignContent } from './campaign_content.entity';
import { CampaignContentService } from './campaign_content.service';
import { CampaignContentController } from './campaign_content.controller';

@Module({
  imports: [TypeOrmModule.forFeature([CampaignContent])],
  providers: [CampaignContentService],
  controllers: [CampaignContentController],
})
export class CampaignContentModule {}
