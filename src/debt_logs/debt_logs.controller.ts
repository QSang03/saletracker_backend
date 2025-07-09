import { Controller, Get, Post, Body, Param, Patch, Delete, Query } from '@nestjs/common';
import { DebtLogsService } from './debt_logs.service';
import { DebtLogs } from './debt_logs.entity';

@Controller('debt-logs')
export class DebtLogsController {
  constructor(private readonly debtLogsService: DebtLogsService) {}

  @Get()
  findAll(@Query() query: any): Promise<DebtLogs[]> {
    return this.debtLogsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: number): Promise<DebtLogs> {
    return this.debtLogsService.findOne(id);
  }

  @Post()
  create(@Body() data: Partial<DebtLogs>): Promise<DebtLogs> {
    return this.debtLogsService.create(data);
  }

  @Patch(':id')
  update(@Param('id') id: number, @Body() data: Partial<DebtLogs>): Promise<DebtLogs> {
    return this.debtLogsService.update(id, data);
  }

  @Delete(':id')
  remove(@Param('id') id: number): Promise<void> {
    return this.debtLogsService.remove(id);
  }
}
