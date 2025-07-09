import { Controller, Get, Post, Body, Param, Patch, Delete } from '@nestjs/common';
import { DebtHistoryService } from './debt_histories.service';
import { DebtHistory } from './debt_histories.entity';

@Controller('debt-histories')
export class DebtHistoryController {
  constructor(private readonly debtHistoryService: DebtHistoryService) {}

  @Get()
  findAll(): Promise<DebtHistory[]> {
    return this.debtHistoryService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: number): Promise<DebtHistory> {
    return this.debtHistoryService.findOne(id);
  }

  @Post()
  create(@Body() data: Partial<DebtHistory>): Promise<DebtHistory> {
    return this.debtHistoryService.create(data);
  }

  @Patch(':id')
  update(@Param('id') id: number, @Body() data: Partial<DebtHistory>): Promise<DebtHistory> {
    return this.debtHistoryService.update(id, data);
  }

  @Delete(':id')
  remove(@Param('id') id: number): Promise<void> {
    return this.debtHistoryService.remove(id);
  }
}
