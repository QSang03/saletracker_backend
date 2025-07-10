import { Controller, Get, Post, Body, Param, Patch, Delete, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { DebtHistoryService } from './debt_histories.service';
import { DebtHistory } from './debt_histories.entity';
import { Permission } from '../common/guards/permission.decorator';
import { PermissionGuard } from '../common/guards/permission.guard';

@Controller('debt-histories')
@UseGuards(AuthGuard('jwt'), PermissionGuard)
export class DebtHistoryController {
  constructor(private readonly debtHistoryService: DebtHistoryService) {}

  @Get()
  @Permission('cong-no', 'read')
  findAll(): Promise<DebtHistory[]> {
    return this.debtHistoryService.findAll();
  }

  @Get(':id')
  @Permission('cong-no', 'read')
  findOne(@Param('id') id: number): Promise<DebtHistory> {
    return this.debtHistoryService.findOne(id);
  }

  @Post()
  @Permission('cong-no', 'create')
  create(@Body() data: Partial<DebtHistory>): Promise<DebtHistory> {
    return this.debtHistoryService.create(data);
  }

  @Patch(':id')
  @Permission('cong-no', 'update')
  update(@Param('id') id: number, @Body() data: Partial<DebtHistory>): Promise<DebtHistory> {
    return this.debtHistoryService.update(id, data);
  }

  @Delete(':id')
  @Permission('cong-no', 'delete')
  remove(@Param('id') id: number): Promise<void> {
    return this.debtHistoryService.remove(id);
  }
}
