import { Controller, Get, Post, Body, Param, Patch, Delete, UseGuards } from '@nestjs/common';
import { CampaignEmailReportService } from './campaign_email_report.service';
import { CampaignEmailReport } from './campaign_email_report.entity';
import { Permission } from '../common/guards/permission.decorator';
import { PermissionGuard } from '../common/guards/permission.guard';
import { AuthGuard } from '@nestjs/passport';

@Controller('campaign-email-reports')
@UseGuards(AuthGuard('jwt'), PermissionGuard)
export class CampaignEmailReportController {
  constructor(private readonly campaignEmailReportService: CampaignEmailReportService) {}

  @Get(':campaign_id')
  @Permission('campaign_email_report', 'read')
  async getByCampaign(@Param('campaign_id') campaign_id: string): Promise<CampaignEmailReport> {
    return this.campaignEmailReportService.getByCampaign(campaign_id);
  }

  @Post()
  @Permission('campaign_email_report', 'create')
  async create(@Body() data: Partial<CampaignEmailReport>): Promise<CampaignEmailReport> {
    return this.campaignEmailReportService.create(data);
  }

  @Patch(':id')
  @Permission('campaign_email_report', 'update')
  async update(@Param('id') id: string, @Body() data: Partial<CampaignEmailReport>): Promise<CampaignEmailReport> {
    return this.campaignEmailReportService.update(id, data);
  }

  @Delete(':id')
  @Permission('campaign_email_report', 'delete')
  async remove(@Param('id') id: string): Promise<void> {
    return this.campaignEmailReportService.remove(id);
  }
}
