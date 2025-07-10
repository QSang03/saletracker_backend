import { Controller, Get, Post, Body, Param, Patch, Delete, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { DebtLogsService } from './debt_logs.service';
import { DebtLogs } from './debt_logs.entity';
import { Permission } from '../common/guards/permission.decorator';
import { PermissionGuard } from '../common/guards/permission.guard';

@Controller('debt-logs')
@UseGuards(AuthGuard('jwt'), PermissionGuard)
export class DebtLogsController {
  constructor(private readonly debtLogsService: DebtLogsService) {}

  @Get()
  @Permission('cong-no', 'read')
  findAll(@Query() query: any): Promise<DebtLogs[]> {
    return this.debtLogsService.findAll(query);
  }

  @Get(':id')
  @Permission('cong-no', 'read')
  findOne(@Param('id') id: number): Promise<DebtLogs> {
    return this.debtLogsService.findOne(id);
  }

  @Post()
  @Permission('cong-no', 'create')
  create(@Body() data: Partial<DebtLogs>): Promise<DebtLogs> {
    return this.debtLogsService.create(data);
  }

  @Patch(':id')
  @Permission('cong-no', 'update')
  update(@Param('id') id: number, @Body() data: Partial<DebtLogs>): Promise<DebtLogs> {
    return this.debtLogsService.update(id, data);
  }

  @Delete(':id')
  @Permission('cong-no', 'delete')
  remove(@Param('id') id: number): Promise<void> {
    return this.debtLogsService.remove(id);
  }
}
