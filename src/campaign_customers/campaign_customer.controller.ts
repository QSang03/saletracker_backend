import { Controller, Get, Post, Body, Param, Patch, Delete, Query, UseGuards } from '@nestjs/common';
import { CampaignCustomerService } from './campaign_customer.service';
import { CampaignCustomer } from './campaign_customer.entity';
import { Permission } from '../common/guards/permission.decorator';
import { PermissionGuard } from '../common/guards/permission.guard';
import { AuthGuard } from '@nestjs/passport';

@Controller('campaign-customers')
@UseGuards(AuthGuard('jwt'), PermissionGuard)
export class CampaignCustomerController {
  constructor(private readonly campaignCustomerService: CampaignCustomerService) {}

  @Get()
  @Permission('campaign_customer', 'read')
  async findAll(@Query() query: any): Promise<CampaignCustomer[]> {
    return this.campaignCustomerService.findAll(query);
  }

  @Get(':id')
  @Permission('campaign_customer', 'read')
  async findOne(@Param('id') id: string): Promise<CampaignCustomer> {
    return this.campaignCustomerService.findOne(id);
  }

  @Post()
  @Permission('campaign_customer', 'create')
  async create(@Body() data: Partial<CampaignCustomer>): Promise<CampaignCustomer> {
    return this.campaignCustomerService.create(data);
  }

  @Patch(':id')
  @Permission('campaign_customer', 'update')
  async update(@Param('id') id: string, @Body() data: Partial<CampaignCustomer>): Promise<CampaignCustomer> {
    return this.campaignCustomerService.update(id, data);
  }

  @Delete(':id')
  @Permission('campaign_customer', 'delete')
  async remove(@Param('id') id: string): Promise<void> {
    return this.campaignCustomerService.remove(id);
  }
}
