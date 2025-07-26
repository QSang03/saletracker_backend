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
  Req,
  BadRequestException 
} from '@nestjs/common';
import { CampaignService } from './campaign.service';
import { Campaign, CampaignStatus } from './campaign.entity';
import { Permission } from '../common/guards/permission.decorator';
import { PermissionGuard } from '../common/guards/permission.guard';
import { AuthGuard } from '@nestjs/passport';

@Controller('campaigns')
@UseGuards(AuthGuard('jwt'), PermissionGuard)
export class CampaignController {
  constructor(private readonly campaignService: CampaignService) {}

  @Get()
  @Permission('kinh-doanh', 'read')
  async findAll(@Query() query: any, @Req() req) {
    return this.campaignService.findAll(query, req.user);
  }

  @Get('stats')
  @Permission('kinh-doanh', 'read')
  async getStats(@Req() req) {
    return this.campaignService.getStats(req.user);
  }

  @Get(':id')
  @Permission('kinh-doanh', 'read')
  async findOne(@Param('id') id: string, @Req() req): Promise<Campaign> {
    return this.campaignService.findOne(id, req.user);
  }

  @Post()
  @Permission('kinh-doanh', 'create')
  async create(@Body() data: Partial<Campaign>, @Req() req): Promise<Campaign> {
    return this.campaignService.create(data, req.user);
  }

  @Patch(':id')
  @Permission('kinh-doanh', 'update')
  async update(
    @Param('id') id: string,
    @Body() data: Partial<Campaign>,
    @Req() req
  ): Promise<Campaign> {
    return this.campaignService.update(id, data, req.user);
  }

  @Patch(':id/status')
  @Permission('kinh-doanh', 'update')
  async updateStatus(
    @Param('id') id: string,
    @Body('status') status: CampaignStatus,
    @Req() req
  ): Promise<Campaign> {
    if (!Object.values(CampaignStatus).includes(status)) {
      throw new BadRequestException('Trạng thái không hợp lệ');
    }
    return this.campaignService.updateStatus(id, status, req.user);
  }

  @Patch(':id/archive')
  @Permission('kinh-doanh', 'update')
  async archive(@Param('id') id: string, @Req() req): Promise<Campaign> {
    return this.campaignService.archive(id, req.user);
  }

  @Delete(':id')
  @Permission('kinh-doanh', 'delete')
  async delete(@Param('id') id: string, @Req() req): Promise<{ success: boolean }> {
    await this.campaignService.delete(id, req.user);
    return { success: true };
  }
}
