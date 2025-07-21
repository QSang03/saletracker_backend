import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CampaignEmailReport } from './campaign_email_report.entity';
import { CampaignEmailReportService } from './campaign_email_report.service';
import { CampaignEmailReportController } from './campaign_email_report.controller';

@Module({
  imports: [TypeOrmModule.forFeature([CampaignEmailReport])],
  providers: [CampaignEmailReportService],
  controllers: [CampaignEmailReportController],
})
export class CampaignEmailReportModule {}
