import { Controller, Get, Post, Body, Param, Patch, Delete } from '@nestjs/common';
import { DebtService } from './debt.service';

@Controller('debts')
export class DebtController {
  constructor(private readonly debtService: DebtService) {}

  @Get()
  findAll() {
    return this.debtService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: number) {
    return this.debtService.findOne(id);
  }

  @Post()
  create(@Body() body: any) {
    return this.debtService.create(body);
  }

  @Patch(':id')
  update(@Param('id') id: number, @Body() body: any) {
    return this.debtService.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: number) {
    return this.debtService.remove(id);
  }
}
