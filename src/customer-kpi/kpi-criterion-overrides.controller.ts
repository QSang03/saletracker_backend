import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { Permission } from '../common/guards/permission.decorator';
import { KpiCriterionOverridesService } from './kpi-criterion-overrides.service';
import {
  CreateKpiCriterionOverrideDto,
  KpiCriterionOverrideQueryDto,
} from './dto/kpi-criterion-overrides.dto';

/**
 * Ghi đè thủ công tiêu chí 3/4 (customer_kpi_overrides). Quản lý ghi trực
 * tiếp, không qua duyệt — giới hạn ở service: admin hoặc trưởng phòng cùng
 * phòng; sale tự sửa KPI của mình bị chặn.
 */
@Controller('customer-kpi-overrides')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class KpiCriterionOverridesController {
  constructor(
    private readonly overridesService: KpiCriterionOverridesService,
  ) {}

  @Get()
  @Permission('khach-hang', 'read')
  list(@Query() query: KpiCriterionOverrideQueryDto, @Req() req: any) {
    return this.overridesService.list(query, req.user);
  }

  @Post()
  @Permission('khach-hang', 'update')
  create(@Body() dto: CreateKpiCriterionOverrideDto, @Req() req: any) {
    return this.overridesService.create(dto, req.user);
  }

  @Delete(':id')
  @Permission('khach-hang', 'update')
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.overridesService.remove(id, req.user);
  }
}
