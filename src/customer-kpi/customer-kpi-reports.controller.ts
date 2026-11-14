import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { Permission } from '../common/guards/permission.decorator';
import { CustomerKpiReportsService } from './customer-kpi-reports.service';
import { KpiCoverageService } from './kpi-coverage.service';
import { KpiCareFunnelService } from './kpi-care-funnel.service';
import { KpiSlaService } from './kpi-sla.service';
import { KpiUser } from './kpi-scope.service';
import {
  KpiBySaleQueryDto,
  KpiOverviewQueryDto,
} from './dto/kpi-report-query.dto';
import {
  CareFunnelQueryDto,
  ComputeMonthlyDto,
  ComputeQuarterDto,
  DailyTrackingQueryDto,
  FinalizeQuarterDto,
  KpiMonthlyQueryDto,
  KpiQuarterQueryDto,
  KpiSlaQueryDto,
  KpiSlaSummaryQueryDto,
  ReopenQuarterDto,
  SetMonthlyBonusDto,
  SetRevenueVisibilityDto,
  WaiveSlaViolationDto,
} from './dto/kpi-coverage.dto';
import { KpiRevenueViewService } from './kpi-revenue-view.service';
import { shiftDateStr, vnToday } from './vn-date';

/**
 * Nhóm API báo cáo KPI.
 *
 * Quyền xem: dùng nguyên vẹn resolveScope của sale-response (admin toàn công
 * ty, view/manager/user theo quy tắc sẵn có). Kết quả KPI có 3 trạng thái:
 * pass/fail (binary) | ratio | no_data (kèm reason) — xem cấu trúc trong
 * tài liệu thiết kế, phần "Danh sách API".
 *
 * Khoảng xem: ưu tiên `fiscal_year` + `quarter` (mặc định quý tài chính hiện
 * tại), sau tới `from`/`to`. Chỉ quý mới có target + kết luận đạt/không đạt;
 * tuần/tháng chỉ báo doanh thu thực.
 */
@Controller('customer-kpi-reports')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class CustomerKpiReportsController {
  constructor(
    private readonly reportsService: CustomerKpiReportsService,
    private readonly coverageService: KpiCoverageService,
    private readonly careFunnelService: KpiCareFunnelService,
    private readonly slaService: KpiSlaService,
    private readonly revenueViewService: KpiRevenueViewService,
  ) {}

  private normalizeRange(from?: string, to?: string) {
    // Mặc định 30 ngày gần nhất tính theo ngày VN — không phụ thuộc múi giờ server
    const today = vnToday();
    return {
      from: /^\d{4}-\d{2}-\d{2}$/.test(from ?? '')
        ? (from as string)
        : shiftDateStr(today, -30),
      to: /^\d{4}-\d{2}-\d{2}$/.test(to ?? '') ? (to as string) : today,
    };
  }

  /**
   * Công tắc xem doanh số của sale khác.
   * - enabled = true (mặc định): xem số doanh số/doanh thu.
   * - enabled = false: chỉ xem %.
   * Lương/thưởng luôn bị mask, không phụ thuộc công tắc.
   */
  @Get('settings/revenue-visibility')
  @Permission('khach-hang', 'read')
  getRevenueVisibility() {
    return this.revenueViewService.getSettings();
  }

  @Patch('settings/revenue-visibility')
  @Permission('khach-hang', 'update')
  setRevenueVisibility(
    @Body() dto: SetRevenueVisibilityDto,
    @Req() req: { user: KpiUser },
  ) {
    return this.revenueViewService.setEnabled(dto.enabled, req.user);
  }

  @Get('overview')
  @Permission('khach-hang', 'read')
  overview(@Query() query: KpiOverviewQueryDto, @Req() req: any) {
    // from/to/sắp quý do service phân giải (resolveWindow) — controller không
    // gán mặc định 30 ngày nữa vì sẽ đè lên khoảng quý
    return this.reportsService.overview(query, req.user);
  }

  @Get('by-sale')
  @Permission('khach-hang', 'read')
  bySale(@Query() query: KpiBySaleQueryDto, @Req() req: any) {
    return this.reportsService.bySale(query, req.user);
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
    return this.reportsService.getCustomerDetail(
      id,
      range.from,
      range.to,
      req.user,
    );
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
    @Query() query: any,
    @Req() req: any,
    @Res() res: any,
  ) {
    const { buffer, fileName } = await this.reportsService.exportReport(
      saleId ? Number(saleId) : undefined,
      query,
      req.user,
    );
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buffer);
  }

  // ------------------------------------------------ chuẩn hóa KPI (mới)

  @Get('daily-tracking')
  @Permission('khach-hang', 'read')
  dailyTracking(
    @Query() query: DailyTrackingQueryDto,
    @Req() req: { user: KpiUser },
  ) {
    return this.coverageService.dailyTracking({ ...query, user: req.user });
  }

  @Get('care-funnel')
  @Permission('khach-hang', 'read')
  careFunnel(
    @Query() query: CareFunnelQueryDto,
    @Req() req: { user: KpiUser },
  ) {
    return this.careFunnelService.getStats({ ...query, user: req.user });
  }

  @Get('sla-violations')
  @Permission('khach-hang', 'read')
  slaViolations(@Query() query: KpiSlaQueryDto, @Req() req: { user: KpiUser }) {
    return this.slaService.listViolations(query, req.user);
  }

  /** Tin nhắn quanh thời điểm vi phạm — ngữ cảnh để sale viết giải trình. */
  @Get('sla-violations/:id/messages')
  @Permission('khach-hang', 'read')
  slaViolationMessages(
    @Param('id', ParseIntPipe) id: number,
    @Query('limit') limit: string | undefined,
    @Req() req: { user: KpiUser },
  ) {
    return this.slaService.getMessagesForViolation(
      id,
      req.user,
      limit ? Number(limit) : 100,
    );
  }

  /** Admin hủy/miễn vi phạm thủ công (SLA ghi nhận sai). */
  @Patch('sla-violations/:id/waive')
  @Permission('khach-hang', 'approve')
  waiveSlaViolation(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: WaiveSlaViolationDto,
    @Req() req: { user: KpiUser },
  ) {
    return this.slaService.setWaived(id, dto, req.user);
  }

  @Get('sla-summary')
  @Permission('khach-hang', 'read')
  slaSummary(
    @Query() query: KpiSlaSummaryQueryDto,
    @Req() req: { user: KpiUser },
  ) {
    return this.slaService.summary(query, req.user);
  }

  @Get('monthly-results')
  @Permission('khach-hang', 'read')
  monthlyResults(
    @Query() query: KpiMonthlyQueryDto,
    @Req() req: { user: KpiUser },
  ) {
    return this.coverageService.listMonthlyResults(query, req.user);
  }

  @Post('monthly-results/compute')
  @Permission('khach-hang', 'update')
  computeMonthly(
    @Body() dto: ComputeMonthlyDto,
    @Req() req: { user: KpiUser },
  ) {
    return this.coverageService.computeMonthlyResults({
      periodMonth: dto.period,
      saleId: dto.saleId,
      user: req.user,
      force: dto.force,
      reason: dto.reason,
    });
  }

  @Patch('monthly-results/:id/bonus')
  @Permission('khach-hang', 'update')
  setMonthlyBonus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetMonthlyBonusDto,
    @Req() req: { user: KpiUser },
  ) {
    return this.coverageService.setMonthlyBonus(id, dto, req.user);
  }

  @Get('quarter-settlements')
  @Permission('khach-hang', 'read')
  quarterSettlements(
    @Query() query: KpiQuarterQueryDto,
    @Req() req: { user: KpiUser },
  ) {
    return this.coverageService.listQuarterSettlements(query, req.user);
  }

  @Post('quarter-settlements/compute')
  @Permission('khach-hang', 'update')
  computeQuarter(
    @Body() dto: ComputeQuarterDto,
    @Req() req: { user: KpiUser },
  ) {
    return this.coverageService.computeQuarterSettlements({
      fiscalYear: dto.fiscal_year,
      quarter: dto.quarter,
      saleId: dto.saleId,
      user: req.user,
      force: dto.force,
      reason: dto.reason,
    });
  }

  @Post('quarter-settlements/finalize')
  @Permission('khach-hang', 'update')
  finalizeQuarter(
    @Body() dto: FinalizeQuarterDto,
    @Req() req: { user: KpiUser },
  ) {
    return this.coverageService.finalizeQuarterSettlement(
      {
        fiscalYear: dto.fiscal_year,
        quarter: dto.quarter,
        saleId: dto.saleId,
      },
      req.user,
    );
  }

  @Post('quarter-settlements/reopen')
  @Permission('khach-hang', 'update')
  reopenQuarter(@Body() dto: ReopenQuarterDto, @Req() req: { user: KpiUser }) {
    return this.coverageService.reopenQuarterSettlement(
      {
        fiscalYear: dto.fiscal_year,
        quarter: dto.quarter,
        saleId: dto.saleId,
        reason: dto.reason,
      },
      req.user,
    );
  }
}
