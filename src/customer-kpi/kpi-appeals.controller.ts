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
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { Permission } from '../common/guards/permission.decorator';
import { KpiAppealStatus } from './kpi-appeal.entity';
import { KpiAppealService } from './kpi-appeal.service';
import {
  CreateKpiAppealDto,
  KpiAppealQueryDto,
  ReviewKpiAppealDto,
} from './dto/kpi-coverage.dto';
import { KpiUser } from './kpi-scope.service';

/**
 * Khiếu nại vi phạm SLA 2h.
 *
 * Sale gửi cho đúng một vi phạm của mình; Leader/Admin duyệt. Duyệt xong
 * `is_waived=1` nên báo cáo KPI thấy ngay, không cần recompute.
 */
@Controller('customer-kpi-appeals')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class KpiAppealsController {
  constructor(private readonly appealsService: KpiAppealService) {}

  @Post()
  @Permission('khach-hang', 'update')
  create(@Body() dto: CreateKpiAppealDto, @Req() req: { user: KpiUser }) {
    return this.appealsService.create(
      {
        violationId: dto.violationId,
        reason: dto.reason,
        evidenceUrls: dto.evidenceUrls,
      },
      req.user,
    );
  }

  @Get()
  @Permission('khach-hang', 'read')
  list(@Query() query: KpiAppealQueryDto, @Req() req: { user: KpiUser }) {
    return this.appealsService.list(
      {
        period: query.period,
        saleId: query.saleId,
        status: query.status ? (query.status as KpiAppealStatus) : undefined,
      },
      req.user,
    );
  }

  @Patch(':id/review')
  @Permission('khach-hang', 'approve')
  review(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReviewKpiAppealDto,
    @Req() req: { user: KpiUser },
  ) {
    return this.appealsService.review(
      id,
      {
        status:
          dto.status === 'approved'
            ? KpiAppealStatus.APPROVED
            : KpiAppealStatus.REJECTED,
        reviewNote: dto.reviewNote,
      },
      req.user,
    );
  }
}
