import { 
  Controller, 
  Get, 
  Post, 
  Body, 
  Param, 
  Patch, 
  Delete, 
  UseGuards, 
  Req 
} from '@nestjs/common';
import { CampaignScheduleService } from './campaign_schedule.service';
import { CampaignSchedule } from './campaign_schedule.entity';
import { Permission } from '../common/guards/permission.decorator';
import { PermissionGuard } from '../common/guards/permission.guard';
import { AuthGuard } from '@nestjs/passport';

@Controller('campaign-schedules')
@UseGuards(AuthGuard('jwt'), PermissionGuard)
export class CampaignScheduleController {
  constructor(private readonly campaignScheduleService: CampaignScheduleService) {}

  @Get(':campaignId')
  @Permission('chien-dich', 'read')
  async getByCampaign(@Param('campaignId') campaignId: string, @Req() req): Promise<CampaignSchedule> {
    return this.campaignScheduleService.getByCampaign(campaignId, req.user);
  }

  @Post()
  @Permission('chien-dich', 'create')
  async create(@Body() data: Partial<CampaignSchedule>, @Req() req): Promise<CampaignSchedule> {
    return this.campaignScheduleService.create(data, req.user);
  }

  @Patch(':id')
  @Permission('chien-dich', 'update')
  async update(
    @Param('id') id: string, 
    @Body() data: Partial<CampaignSchedule>,
    @Req() req
  ): Promise<CampaignSchedule> {
    return this.campaignScheduleService.update(id, data, req.user);
  }

  @Delete(':id')
  @Permission('chien-dich', 'delete')
  async remove(@Param('id') id: string, @Req() req): Promise<void> {
    return this.campaignScheduleService.remove(id, req.user);
  }
}
