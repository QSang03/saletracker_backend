import { Controller, Get, Post, Body, Param, Patch, Delete, Query } from '@nestjs/common';
import { DebtConfigService } from './debt_configs.service';
import { DebtConfig } from './debt_configs.entity';

@Controller('debt-configs')
export class DebtConfigController {
  constructor(private readonly debtConfigService: DebtConfigService) {}

  @Get()
  findAll(@Query() query: any): Promise<DebtConfig[]> {
    return this.debtConfigService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: number): Promise<DebtConfig> {
    return this.debtConfigService.findOne(id);
  }

  @Post()
  create(@Body() data: Partial<DebtConfig>): Promise<DebtConfig> {
    return this.debtConfigService.create(data);
  }

  @Patch(':id')
  update(@Param('id') id: number, @Body() data: Partial<DebtConfig>): Promise<DebtConfig> {
    return this.debtConfigService.update(id, data);
  }

  @Delete(':id')
  remove(@Param('id') id: number): Promise<void> {
    return this.debtConfigService.remove(id);
  }
}
