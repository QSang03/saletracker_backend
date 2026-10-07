import {
  Body,
  Controller,
  Delete,
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
import { CustomerKpiDefinitionsService } from './customer-kpi-definitions.service';
import {
  CreateKpiDefinitionDto,
  KpiDefinitionQueryDto,
  UpdateKpiDefinitionDto,
} from './dto/kpi-definition.dto';

/** Cấu hình tiêu chí KPI theo nhóm (thiết kế mục 5.1 — kpi_definitions). */
@Controller('customer-kpi-definitions')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class CustomerKpiDefinitionsController {
  constructor(
    private readonly definitionsService: CustomerKpiDefinitionsService,
  ) {}

  @Get()
  @Permission('khach-hang', 'read')
  list(@Query() query: KpiDefinitionQueryDto) {
    return this.definitionsService.list(query);
  }

  @Post()
  @Permission('khach-hang', 'update')
  create(@Body() dto: CreateKpiDefinitionDto, @Req() req: any) {
    return this.definitionsService.create(dto, req.user);
  }

  @Patch(':id')
  @Permission('khach-hang', 'update')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateKpiDefinitionDto,
    @Req() req: any,
  ) {
    return this.definitionsService.update(id, dto, req.user);
  }

  @Delete(':id')
  @Permission('khach-hang', 'update')
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.definitionsService.remove(id, req.user);
  }
}
