import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { Permission } from '../common/guards/permission.decorator';
import { CustomerKpiTargetsService } from './customer-kpi-targets.service';
import { AssignKpiTargetsDto, KpiTargetQueryDto } from './dto/kpi-target.dto';

/**
 * Chỉ tiêu theo tháng (kpi_targets). Gán qua 3 cách: theo phòng (hàng loạt
 * tạo dòng cấp nhân viên), theo nhân viên, theo từng khách hàng.
 * Admin áp dụng thẳng; trưởng phòng nhập -> tạo đề xuất chờ admin duyệt.
 */
@Controller('customer-kpi-targets')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class CustomerKpiTargetsController {
  constructor(private readonly targetsService: CustomerKpiTargetsService) {}

  @Get()
  @Permission('khach-hang', 'read')
  list(@Query() query: KpiTargetQueryDto, @Req() req: any) {
    return this.targetsService.list(query, req.user);
  }

  @Post()
  @Permission('khach-hang', 'update')
  assign(@Body() dto: AssignKpiTargetsDto, @Req() req: any) {
    return this.targetsService.assign(dto, req.user);
  }
}
