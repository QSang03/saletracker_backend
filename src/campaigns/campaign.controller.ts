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
  Res,
  BadRequestException,
} from '@nestjs/common';
import { CampaignService, CampaignWithDetails } from './campaign.service';
import { Campaign, CampaignStatus } from './campaign.entity';
import {
  CreateCampaignDto,
  CustomerDto,
  UpdateCampaignDto,
} from './campaign.dto';
import { Permission } from '../common/guards/permission.decorator';
import { PermissionGuard } from '../common/guards/permission.guard';
import { AuthGuard } from '@nestjs/passport';
import { Response } from 'express';

@Controller('campaigns')
@UseGuards(AuthGuard('jwt'), PermissionGuard)
export class CampaignController {
  constructor(private readonly campaignService: CampaignService) {}

  @Get()
  @Permission('chien-dich', 'read')
  async findAll(@Query() query: any, @Req() req) {
    return this.campaignService.findAll(query, req.user);
  }

  @Get('stats')
  @Permission('chien-dich', 'read')
  async getStats(@Req() req) {
    return this.campaignService.getStats(req.user);
  }

  @Get('archived')
  @Permission('chien-dich', 'read')
  async findAllArchived(@Query() query: any, @Req() req) {
    return this.campaignService.findAllArchived(query, req.user);
  }

  @Get(':id/copy-data')
  @Permission('chien-dich', 'read')
  async getCopyData(
    @Param('id') id: string,
    @Req() req,
  ): Promise<CreateCampaignDto> {
    return this.campaignService.getCopyData(id, req.user);
  }

  @Get(':id/export-summary')
  @Permission('chien-dich', 'read')
  async exportCampaignSummary(
    @Param('id') id: string,
    @Res() res: Response,
    @Req() req,
  ) {
    try {
      const stream = await this.campaignService.exportCampaignSummary(
        id,
        req.user,
      );

      // Lấy campaign để đặt tên file
      const campaign = await this.campaignService.findOne(id, req.user);

      // ✅ SỬA: Sanitize tên campaign và encode đúng cách
      const safeCampaignName = campaign.name
        .replace(/[^a-zA-Z0-9\s]/g, '') // Loại bỏ ký tự đặc biệt
        .replace(/\s+/g, '_') // Thay space bằng underscore
        .substring(0, 50); // Giới hạn độ dài

      const timestamp = new Date().getTime();
      const fileName = `campaign_summary_${safeCampaignName}_${timestamp}.xlsx`;

      // ✅ SỬA: Encode filename đúng cách cho HTTP header
      const encodedFileName = encodeURIComponent(fileName);

      res.header(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );

      // ✅ SỬA: Sử dụng cả filename và filename* để support đa browser
      res.header(
        'Content-Disposition',
        `attachment; filename="${fileName.replace(/[^\x00-\x7F]/g, '_')}"; filename*=UTF-8''${encodedFileName}`,
      );

      stream.pipe(res);
    } catch (error) {
      console.error('Error exporting campaign summary:', error);
      throw new BadRequestException('Không thể xuất báo cáo chiến dịch');
    }
  }

  @Get(':id')
  @Permission('chien-dich', 'read')
  async findOne(
    @Param('id') id: string,
    @Req() req,
  ): Promise<CampaignWithDetails> {
    return this.campaignService.findOne(id, req.user);
  }

  @Patch(':campaignId/customers/:customerId')
  @Permission('chien-dich', 'update')
  async updateCampaignCustomer(
    @Param('campaignId') campaignId: string,
    @Param('customerId') customerId: string,
    @Body() data: CustomerDto,
    @Req() req,
  ): Promise<{ success: boolean; message: string }> {
    return this.campaignService.updateCampaignCustomer(
      campaignId,
      customerId,
      data,
      req.user,
    );
  }

  @Post()
  @Permission('chien-dich', 'create')
  async create(
    @Body() data: CreateCampaignDto,
    @Req() req,
  ): Promise<CampaignWithDetails> {
    return this.campaignService.create(data, req.user);
  }

  @Patch(':id')
  @Permission('chien-dich', 'update')
  async update(
    @Param('id') id: string,
    @Body() data: UpdateCampaignDto,
    @Req() req,
  ): Promise<CampaignWithDetails> {
    return this.campaignService.update(id, data, req.user);
  }

  @Patch(':id/status')
  @Permission('chien-dich', 'update')
  async updateStatus(
    @Param('id') id: string,
    @Body('status') status: CampaignStatus,
    @Req() req,
  ): Promise<CampaignWithDetails> {
    if (!Object.values(CampaignStatus).includes(status)) {
      throw new BadRequestException('Trạng thái không hợp lệ');
    }
    return this.campaignService.updateStatus(id, status, req.user);
  }

  @Patch(':id/archive')
  @Permission('chien-dich', 'update')
  async archive(
    @Param('id') id: string,
    @Req() req,
  ): Promise<CampaignWithDetails> {
    return this.campaignService.archive(id, req.user);
  }

  @Delete(':id')
  @Permission('chien-dich', 'delete')
  async delete(
    @Param('id') id: string,
    @Req() req,
  ): Promise<{ success: boolean }> {
    await this.campaignService.delete(id, req.user);
    return { success: true };
  }

  @Get(':id/customers')
  @Permission('chien-dich', 'read')
  async getCampaignCustomers(
    @Param('id') id: string,
    @Query() query: any,
    @Req() req,
  ) {
    return this.campaignService.getCampaignCustomers(id, query, req.user);
  }

  @Get(':id/customers/export')
  @Permission('chien-dich', 'read')
  async exportCampaignCustomers(
    @Param('id') id: string,
    @Query() query: any,
    @Res() res: Response,
    @Req() req,
  ) {
    const stream = await this.campaignService.exportCustomers(
      id,
      query,
      req.user,
    );
    res.header(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.header('Content-Disposition', 'attachment; filename="customers.xlsx"');
    stream.pipe(res);
  }

  // @Get(':cid/customers/:uid/logs')
  // @Permission('chien-dich', 'read')
  // async getCustomerLogs(
  //   @Param('cid') campaignId: string,
  //   @Param('uid') customerId: string,
  //   @Req() req
  // ) {
  //   return this.campaignService.getCustomerLogs(campaignId, customerId, req.user);
  // }

  @Get(':campaignId/customers/:customerId/logs')
  async getCustomerLogs(
    @Param('campaignId') campaignId: string,
    @Param('customerId') customerId: string,
    @Req() req: any,
    @Query('sent_date') sentDate?: string,
  ) {
    return this.campaignService.getCustomerLogs(
      campaignId,
      customerId,
      req.user,
      sentDate,
    );
  }
}
