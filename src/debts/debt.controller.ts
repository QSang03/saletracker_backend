import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Delete,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  Query,
  Req,
} from '@nestjs/common';
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
  async findAll(@Query() query: any, @Req() req) {
    // Lấy page và pageSize từ query, mặc định page=1, pageSize=10
    const page = Number(query.page) > 0 ? Number(query.page) : 1;
    const pageSize = Number(query.pageSize) > 0 ? Number(query.pageSize) : 10;
    const result = await this.debtService.findAll(
      query,
      req.user,
      page,
      pageSize,
    );
    return result;
  }

  @Get('customers')
  @Permission('cong-no', 'read')
  async getUniqueCustomers(@Req() req) {
    return this.debtService.getUniqueCustomerList(req.user);
  }

  @Get('stats')
  @Permission('cong-no', 'read')
  async getStats(@Query() query: any, @Req() req) {
    // Lấy toàn bộ dữ liệu theo filter (nếu có), không phân trang
    const result = await this.debtService.findAll(query, req.user, 1, 1000000); // lấy tối đa 1 triệu bản ghi
    const debts = result.data || [];

    // Tổng tiền của tất cả các phiếu
    const totalAmount = debts.reduce(
      (sum, d) => sum + (Number(d.total_amount) || 0),
      0,
    );

    // Tổng số phiếu
    const totalBills = debts.length;

    // 1. Tổng tiền các phiếu có trạng thái "paid" (đã thanh toán)
    const totalPaidAmount = debts
      .filter((d) => d.status === 'paid')
      .reduce((sum, d) => sum + (Number(d.total_amount) || 0), 0);

    // 2. Tổng tiền thực tế đã thu (từ tất cả các phiếu)
    const totalCollected = debts.reduce(
      (sum, d) =>
        sum + ((Number(d.total_amount) || 0) - (Number(d.remaining) || 0)),
      0,
    );

    // Số phiếu đã thanh toán
    const totalPaidBills = debts.filter((d) => d.status === 'paid').length;

    return {
      totalAmount,
      totalBills,
      totalCollected, // Tổng tiền thực tế đã thu (65tr trong ví dụ)
      totalPaidAmount, // Tổng tiền các phiếu đã thanh toán (60tr trong ví dụ)
      totalPaidBills,
    };
  }

  @Get('stats/overview')
  @Permission('cong-no', 'read')
  async getStatsOverview(@Query() query: any, @Req() req) {
    return this.debtService.getStatsOverview(query, req.user);
  }

  @Get('stats/aging')
  @Permission('cong-no', 'read')
  async getAgingAnalysis(@Query() query: any, @Req() req) {
    return this.debtService.getAgingAnalysis(query, req.user);
  }

  @Get('stats/trends')
  @Permission('cong-no', 'read')
  async getTrends(@Query() query: any, @Req() req) {
    return this.debtService.getTrends(query, req.user);
  }

  @Get('stats/employee-performance')
  @Permission('cong-no', 'read')
  async getEmployeePerformance(@Query() query: any, @Req() req) {
    return this.debtService.getEmployeePerformance(query, req.user);
  }

  @Get('stats/department-breakdown')
  @Permission('cong-no', 'read')
  async getDepartmentBreakdown(@Query() query: any, @Req() req) {
    return this.debtService.getDepartmentBreakdown(query, req.user);
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
  async softDelete(@Param('id') id: number) {
    if (!id) throw new BadRequestException('ID không hợp lệ');
    await this.debtService.remove(id);
    return { success: true };
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
  async updatePayLater(
    @Body() body: { customerCodes: string[]; payDate: string },
  ) {
    if (!Array.isArray(body.customerCodes) || !body.payDate) {
      throw new BadRequestException('customerCodes và payDate là bắt buộc');
    }
    const payDate = new Date(body.payDate);
    const updated = await this.debtService.updatePayLaterForCustomers(
      body.customerCodes,
      payDate,
    );
    return { updated };
  }

  @Patch(':id/note-status')
  @Permission('cong-no', 'update')
  async updateNoteAndStatus(
    @Param('id') id: number,
    @Body() body: { note?: string; status?: string },
  ) {
    return this.debtService.updateNoteAndStatusKeepUpdatedAt(id, body);
  }
}
