import { 
  Controller, 
  Get, 
  Post, 
  Body, 
  Param, 
  Patch, 
  Delete, 
  Query, 
  UseGuards,
  Req 
} from '@nestjs/common';
import { CampaignInteractionLogService, InteractionStats } from './campaign_interaction_log.service';
import { CampaignInteractionLog, LogStatus } from './campaign_interaction_log.entity';
import { Permission } from '../common/guards/permission.decorator';
import { PermissionGuard } from '../common/guards/permission.guard';
import { AuthGuard } from '@nestjs/passport';

@Controller('campaign-interaction-logs')
@UseGuards(AuthGuard('jwt'), PermissionGuard)
export class CampaignInteractionLogController {
  constructor(private readonly campaignInteractionLogService: CampaignInteractionLogService) {}

  @Get()
  @Permission('chien-dich', 'read')
  async findAll(@Query() query: any, @Req() req): Promise<{
    data: CampaignInteractionLog[];
    total: number;
    stats: InteractionStats;
  }> {
    const { page, pageSize, ...filter } = query;
    return this.campaignInteractionLogService.findAll(filter, page, pageSize, req.user);
  }

  @Get(':id')
  @Permission('chien-dich', 'read')
  async findOne(@Param('id') id: string, @Req() req): Promise<CampaignInteractionLog> {
    return this.campaignInteractionLogService.findOne(id, req.user);
  }

  @Get('campaign/:campaignId')
  @Permission('chien-dich', 'read')
  async getByCampaign(@Param('campaignId') campaignId: string, @Req() req) {
    return this.campaignInteractionLogService.getByCampaign(campaignId, req.user);
  }

  @Patch(':id/status')
  @Permission('chien-dich', 'update')
  async updateStatus(
    @Param('id') id: string, 
    @Body() data: { status: LogStatus; [key: string]: any },
    @Req() req
  ): Promise<CampaignInteractionLog> {
    return this.campaignInteractionLogService.updateLogStatus(id, data.status, data, req.user.id);
  }

  @Post()
  @Permission('chien-dich', 'create')
  async create(@Body() data: Partial<CampaignInteractionLog>, @Req() req): Promise<CampaignInteractionLog> {
    return this.campaignInteractionLogService.create(data, req.user);
  }

  @Patch(':id')
  @Permission('chien-dich', 'update')
  async update(
    @Param('id') id: string, 
    @Body() data: Partial<CampaignInteractionLog>,
    @Req() req
  ): Promise<CampaignInteractionLog> {
    return this.campaignInteractionLogService.update(id, data, req.user);
  }

  @Delete(':id')
  @Permission('chien-dich', 'delete')
  async remove(@Param('id') id: string, @Req() req): Promise<void> {
    return this.campaignInteractionLogService.remove(id, req.user);
  }
}
