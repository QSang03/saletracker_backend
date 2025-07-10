import { Controller, Get, Post, Body, Param, Patch, Delete, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { DebtConfigService } from './debt_configs.service';
import { DebtConfig } from './debt_configs.entity';
import { Permission } from '../common/guards/permission.decorator';
import { PermissionGuard } from '../common/guards/permission.guard';

@Controller('debt-configs')
@UseGuards(AuthGuard('jwt'), PermissionGuard)
export class DebtConfigController {
  constructor(private readonly debtConfigService: DebtConfigService) {}

  @Get()
  @Permission('cong-no', 'read')
  findAll(@Query() query: any): Promise<DebtConfig[]> {
    return this.debtConfigService.findAll();
  }

  @Get(':id')
  @Permission('cong-no', 'read')
  findOne(@Param('id') id: number): Promise<DebtConfig> {
    return this.debtConfigService.findOne(id);
  }

  @Post()
  @Permission('cong-no', 'create')
  create(@Body() data: Partial<DebtConfig>): Promise<DebtConfig> {
    return this.debtConfigService.create(data);
  }

  @Patch(':id')
  @Permission('cong-no', 'update')
  update(@Param('id') id: number, @Body() data: Partial<DebtConfig>): Promise<DebtConfig> {
    return this.debtConfigService.update(id, data);
  }

  @Delete(':id')
  @Permission('cong-no', 'delete')
  remove(@Param('id') id: number): Promise<void> {
    return this.debtConfigService.remove(id);
  }
}
