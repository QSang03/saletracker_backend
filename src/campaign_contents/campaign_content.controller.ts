import { Controller, Get, Post, Body, Param, Patch, Delete, UseGuards } from '@nestjs/common';
import { CampaignContentService } from './campaign_content.service';
import { CampaignContent } from './campaign_content.entity';
import { Permission } from '../common/guards/permission.decorator';
import { PermissionGuard } from '../common/guards/permission.guard';
import { AuthGuard } from '@nestjs/passport';

@Controller('campaign-contents')
@UseGuards(AuthGuard('jwt'), PermissionGuard)
export class CampaignContentController {
  constructor(private readonly campaignContentService: CampaignContentService) {}

  @Get(':campaign_id')
  @Permission('campaign_content', 'read')
  async getByCampaign(@Param('campaign_id') campaign_id: string): Promise<CampaignContent> {
    return this.campaignContentService.getByCampaign(campaign_id);
  }

  @Post()
  @Permission('campaign_content', 'create')
  async create(@Body() data: Partial<CampaignContent>): Promise<CampaignContent> {
    return this.campaignContentService.create(data);
  }

  @Patch(':id')
  @Permission('campaign_content', 'update')
  async update(@Param('id') id: string, @Body() data: Partial<CampaignContent>): Promise<CampaignContent> {
    return this.campaignContentService.update(id, data);
  }

  @Delete(':id')
  @Permission('campaign_content', 'delete')
  async remove(@Param('id') id: string): Promise<void> {
    return this.campaignContentService.remove(id);
  }
}
