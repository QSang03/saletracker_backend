import { Controller, Get, Post, Body, Param, Patch, Delete, UseGuards } from '@nestjs/common';
import { CampaignScheduleService } from './campaign_schedule.service';
import { CampaignSchedule } from './campaign_schedule.entity';
import { Permission } from '../common/guards/permission.decorator';
import { PermissionGuard } from '../common/guards/permission.guard';
import { AuthGuard } from '@nestjs/passport';

@Controller('campaign-schedules')
@UseGuards(AuthGuard('jwt'), PermissionGuard)
export class CampaignScheduleController {
  constructor(private readonly campaignScheduleService: CampaignScheduleService) {}

  @Get(':campaign_id')
  @Permission('campaign_schedule', 'read')
  async getByCampaign(@Param('campaign_id') campaign_id: string): Promise<CampaignSchedule> {
    return this.campaignScheduleService.getByCampaign(campaign_id);
  }

  @Post()
  @Permission('campaign_schedule', 'create')
  async create(@Body() data: Partial<CampaignSchedule>): Promise<CampaignSchedule> {
    return this.campaignScheduleService.create(data);
  }

  @Patch(':id')
  @Permission('campaign_schedule', 'update')
  async update(@Param('id') id: string, @Body() data: Partial<CampaignSchedule>): Promise<CampaignSchedule> {
    return this.campaignScheduleService.update(id, data);
  }

  @Delete(':id')
  @Permission('campaign_schedule', 'delete')
  async remove(@Param('id') id: string): Promise<void> {
    return this.campaignScheduleService.remove(id);
  }
}
