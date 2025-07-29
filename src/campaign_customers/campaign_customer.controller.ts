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
  UseInterceptors,
  UploadedFile,
  Req
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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
  @Permission('chien-dich', 'read')
  async findAll(@Query() query: any, @Req() req): Promise<{ data: CampaignCustomer[]; total: number }> {
    return this.campaignCustomerService.findAll(query, req.user);
  }

  @Get(':id')
  @Permission('chien-dich', 'read')
  async findOne(@Param('id') id: string, @Req() req): Promise<CampaignCustomer> {
    return this.campaignCustomerService.findOne(id, req.user);
  }

  @Post()
  @Permission('chien-dich', 'create')
  async create(@Body() data: Partial<CampaignCustomer>, @Req() req): Promise<CampaignCustomer> {
    return this.campaignCustomerService.create(data, req.user);
  }

  @Post('import')
  @Permission('chien-dich', 'create')
  @UseInterceptors(FileInterceptor('file'))
  async importExcel(
    @UploadedFile() file: Express.Multer.File,
    @Body('campaignId') campaignId: string,
    @Req() req
  ) {
    return this.campaignCustomerService.importFromExcel(file, campaignId, req.user);
  }

  @Patch(':id')
  @Permission('chien-dich', 'update')
  async update(
    @Param('id') id: string, 
    @Body() data: Partial<CampaignCustomer>,
    @Req() req
  ): Promise<CampaignCustomer> {
    return this.campaignCustomerService.update(id, data, req.user);
  }

  @Delete(':id')
  @Permission('chien-dich', 'delete')
  async remove(@Param('id') id: string, @Req() req): Promise<void> {
    return this.campaignCustomerService.remove(id, req.user);
  }
}
