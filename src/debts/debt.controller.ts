import { Controller, Get, Post, Body, Param, Patch, Delete, UploadedFile, UseInterceptors, BadRequestException, Query, Req } from '@nestjs/common';
import { DebtService } from './debt.service';
import { FileInterceptor } from '@nestjs/platform-express';
import * as XLSX from 'xlsx';
import { UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Permission } from '../common/guards/permission.decorator';
import { PermissionGuard } from '../common/guards/permission.guard';

@Controller('debts')
@UseGuards(AuthGuard('jwt'), PermissionGuard)
export class DebtController {
  constructor(private readonly debtService: DebtService) {}

  @Get()
  @Permission('cong-no', 'read')
  findAll(@Query() query: any, @Req() req) {
    return this.debtService.findAll(query, req.user);
  }

  @Get('customers')
  @Permission('cong-no', 'read')
  async getUniqueCustomers(@Req() req) {
    return this.debtService.getUniqueCustomerList(req.user);
  }

  @Get(':id')
  @Permission('cong-no', 'read')
  findOne(@Param('id') id: string) {
    const numId = Number(id);
    if (isNaN(numId) || !isFinite(numId)) {
      throw new BadRequestException('ID không hợp lệ');
    }
    return this.debtService.findOne(numId);
  }

  @Post()
  @Permission('cong-no', 'create')
  create(@Body() body: any) {
    return this.debtService.create(body);
  }

  @Patch(':id')
  @Permission('cong-no', 'update')
  update(@Param('id') id: number, @Body() body: any) {
    return this.debtService.update(id, body);
  }

  @Delete(':id')
  @Permission('cong-no', 'delete')
  remove(@Param('id') id: number) {
    return this.debtService.remove(id);
  }

  @Post('import-excel')
  @Permission('cong-no', 'import')
  @UseInterceptors(FileInterceptor('file'))
  async importExcel(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    const workbook = XLSX.read(file.buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
    return this.debtService.importExcelRows(rows);
  }

  @Post('update-pay-later')
  @Permission('cong-no', 'update')
  async updatePayLater(@Body() body: { customerCodes: string[], payDate: string }) {
    if (!Array.isArray(body.customerCodes) || !body.payDate) {
      throw new BadRequestException('customerCodes và payDate là bắt buộc');
    }
    const payDate = new Date(body.payDate);
    const updated = await this.debtService.updatePayLaterForCustomers(body.customerCodes, payDate);
    return { updated };
  }
}
