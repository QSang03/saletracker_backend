import { Controller, Get, Post, Body, Param, Patch, Delete, Query, UseGuards } from '@nestjs/common';
import { CampaignInteractionLogService } from './campaign_interaction_log.service';
import { CampaignInteractionLog } from './campaign_interaction_log.entity';
import { Permission } from '../common/guards/permission.decorator';
import { PermissionGuard } from '../common/guards/permission.guard';
import { AuthGuard } from '@nestjs/passport';

@Controller('campaign-interaction-logs')
@UseGuards(AuthGuard('jwt'), PermissionGuard)
export class CampaignInteractionLogController {
  constructor(private readonly campaignInteractionLogService: CampaignInteractionLogService) {}

  @Get()
  @Permission('campaign_interaction_log', 'read')
  async findAll(@Query() query: any): Promise<CampaignInteractionLog[]> {
    return this.campaignInteractionLogService.findAll(query);
  }

  @Get(':id')
  @Permission('campaign_interaction_log', 'read')
  async findOne(@Param('id') id: string): Promise<CampaignInteractionLog> {
    return this.campaignInteractionLogService.findOne(id);
  }

  @Post()
  @Permission('campaign_interaction_log', 'create')
  async create(@Body() data: Partial<CampaignInteractionLog>): Promise<CampaignInteractionLog> {
    return this.campaignInteractionLogService.create(data);
  }

  @Patch(':id')
  @Permission('campaign_interaction_log', 'update')
  async update(@Param('id') id: string, @Body() data: Partial<CampaignInteractionLog>): Promise<CampaignInteractionLog> {
    return this.campaignInteractionLogService.update(id, data);
  }

  @Delete(':id')
  @Permission('campaign_interaction_log', 'delete')
  async remove(@Param('id') id: string): Promise<void> {
    return this.campaignInteractionLogService.remove(id);
  }
}
