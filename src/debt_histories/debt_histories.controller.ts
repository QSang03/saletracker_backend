import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Delete,
  Query,
  UseGuards,
} from '@nestjs/common';
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
  update(
    @Param('id') id: number,
    @Body() data: Partial<DebtHistory>,
  ): Promise<DebtHistory> {
    return this.debtHistoryService.update(id, data);
  }

  @Delete(':id')
  @Permission('cong-no', 'delete')
  remove(@Param('id') id: number): Promise<void> {
    return this.debtHistoryService.remove(id);
  }

  @Get('by-debt-config/:debtConfigId')
  @Permission('cong-no', 'read')
  findByDebtConfigId(
    @Param('debtConfigId') debtConfigId: number,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ): Promise<{
    data: DebtHistory[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const pageNum = page ? Number(page) : 1;
    const limitNum = limit ? Number(limit) : 10;
    return this.debtHistoryService.findByDebtConfigId(
      debtConfigId,
      pageNum,
      limitNum,
    );
  }

  @Get(':id/detail')
  @Permission('cong-no', 'read')
  async getDebtHistoryDetail(@Param('id') id: number) {
    return this.debtHistoryService.getDebtHistoryDetail(id);
  }
}
