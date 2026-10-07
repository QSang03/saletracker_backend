import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { Permission } from '../common/guards/permission.decorator';
import { CustomerKpiReportsService } from './customer-kpi-reports.service';

/**
 * Nhóm API báo cáo KPI.
 *
 * Quyền xem: dùng nguyên vẹn resolveScope của sale-response (admin toàn công
 * ty, view/manager/user theo quy tắc sẵn có). Kết quả KPI có 3 trạng thái:
 * pass/fail (binary) | ratio | no_data (kèm reason) — xem cấu trúc trong
 * tài liệu thiết kế, phần "Danh sách API".
 */
@Controller('customer-kpi-reports')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class CustomerKpiReportsController {
  constructor(private readonly reportsService: CustomerKpiReportsService) {}

  private normalizeRange(from?: string, to?: string) {
    const toD = new Date();
    const fromD = new Date();
    fromD.setDate(fromD.getDate() - 30);
    return {
      from: /^\d{4}-\d{2}-\d{2}$/.test(from ?? '')
        ? (from as string)
        : fromD.toISOString().slice(0, 10),
      to: /^\d{4}-\d{2}-\d{2}$/.test(to ?? '')
        ? (to as string)
        : toD.toISOString().slice(0, 10),
    };
  }

  @Get('overview')
  @Permission('khach-hang', 'read')
  overview(
    @Query('saleId') saleId: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Req() req: any,
  ) {
    const range = this.normalizeRange(from, to);
    return this.reportsService.overview(
      { saleId: saleId ? Number(saleId) : undefined, ...range },
      req.user,
    );
  }

  @Get('by-sale')
  @Permission('khach-hang', 'read')
  bySale(
    @Query('saleId') saleId: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Req() req: any,
  ) {
    const range = this.normalizeRange(from, to);
    return this.reportsService.bySale(
      { saleId: saleId ? Number(saleId) : undefined, ...range },
      req.user,
    );
  }

  @Get('customers/:id')
  @Permission('khach-hang', 'read')
  customerDetail(
    @Param('id', ParseIntPipe) id: number,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Req() req: any,
  ) {
    const range = this.normalizeRange(from, to);
    return this.reportsService.getCustomerDetail(id, range.from, range.to, req.user);
  }

  @Get('suggestions')
  @Permission('khach-hang', 'read')
  suggestions(@Query('saleId') saleId: string | undefined, @Req() req: any) {
    return this.reportsService.suggestions(
      saleId ? Number(saleId) : undefined,
      req.user,
    );
  }

  @Get('export')
  @Permission('khach-hang', 'export')
  async export(
    @Query('saleId') saleId: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Req() req: any,
    @Res() res: any,
  ) {
    const range = this.normalizeRange(from, to);
    const { buffer, fileName } = await this.reportsService.exportReport(
      saleId ? Number(saleId) : undefined,
      range.from,
      range.to,
      req.user,
    );
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buffer);
  }
}
