import { Controller, Get, Post, Body, Param, Patch, Delete, Query, UseGuards, Req } from '@nestjs/common';
import { CampaignService } from './campaign.service';
import { Campaign } from './campaign.entity';
import { Permission } from '../common/guards/permission.decorator';
import { PermissionGuard } from '../common/guards/permission.guard';
import { AuthGuard } from '@nestjs/passport';

@Controller('campaigns')
@UseGuards(AuthGuard('jwt'), PermissionGuard)
export class CampaignController {
  constructor(private readonly campaignService: CampaignService) {}

  @Get()
  @Permission('campaign', 'read')
  async findAll(@Query() query: any, @Req() req): Promise<Campaign[]> {
    return this.campaignService.findAll(query, req.user);
  }

  @Get(':id')
  @Permission('campaign', 'read')
  async findOne(@Param('id') id: string): Promise<Campaign> {
    return this.campaignService.findOne(id);
  }

  @Post()
  @Permission('campaign', 'create')
  async create(@Body() data: Partial<Campaign>, @Req() req): Promise<Campaign> {
    return this.campaignService.create(data, req.user);
  }

  @Patch(':id')
  @Permission('campaign', 'update')
  async update(@Param('id') id: string, @Body() data: Partial<Campaign>): Promise<Campaign> {
    return this.campaignService.update(id, data);
  }

  @Delete(':id')
  @Permission('campaign', 'delete')
  async remove(@Param('id') id: string): Promise<void> {
    return this.campaignService.remove(id);
  }
}
