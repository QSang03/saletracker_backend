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
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { AuthGuard } from '@nestjs/passport';
import { DebtConfigService } from './debt_configs.service';
import { DebtConfig } from './debt_configs.entity';
import { Permission } from '../common/guards/permission.decorator';
import { PermissionGuard } from '../common/guards/permission.guard';
import { Request } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';

@Controller('debt-configs')
@UseGuards(AuthGuard('jwt'), PermissionGuard)
export class DebtConfigController {
  constructor(private readonly debtConfigService: DebtConfigService) {}

  @Get()
  @Permission('cong-no', 'read')
  findAll(@Query() query: any, @Req() req): Promise<{
    data: any[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    // Parse query parameters
    const filters = {
      search: query.search,
      employees: query.employees ? (Array.isArray(query.employees) ? query.employees.map(Number) : [Number(query.employees)]) : undefined,
      singleDate: query.singleDate,
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 10,
    };

    return this.debtConfigService.findAllWithRole(req.user, filters);
  }

  @Get(':id')
  @Permission('cong-no', 'read')
  findOne(@Param('id') id: number): Promise<DebtConfig> {
    return this.debtConfigService.findOne(id);
  }

  @Get(':id/detail')
  @Permission('cong-no', 'read')
  async getDebtConfigDetail(@Param('id') id: number) {
    return this.debtConfigService.getDebtConfigDetail(id);
  }

  @Post()
  @Permission('cong-no', 'create')
  create(
    @Body() data: Partial<DebtConfig>,
    @Req() req: any,
  ): Promise<DebtConfig> {
    // Gán employee từ user đăng nhập nếu có
    if (req.user && (req.user.id || req.user.userId)) {
      data.employee = { id: req.user.id || req.user.userId } as any;
    }
    return this.debtConfigService.create(data);
  }

  @Patch(':id')
  @Permission('cong-no', 'update')
  update(
    @Param('id') id: number,
    @Body() data: Partial<DebtConfig>,
  ): Promise<DebtConfig> {
    return this.debtConfigService.update(id, data);
  }

  @Delete(':id')
  @Permission('cong-no', 'delete')
  remove(@Param('id') id: number): Promise<void> {
    return this.debtConfigService.remove(id);
  }

  @Patch(':id/toggle-send')
  @Permission('cong-no', 'update')
  async toggleSend(
    @Param('id') id: number,
    @Body('is_send') is_send: boolean,
    @Req() req: any,
  ) {
    return this.debtConfigService.toggleSend(+id, is_send, req.user);
  }

  @Patch(':id/toggle-repeat')
  @Permission('cong-no', 'update')
  async toggleRepeat(
    @Param('id') id: number,
    @Body('is_repeat') is_repeat: boolean,
    @Req() req: any,
  ) {
    return this.debtConfigService.toggleRepeat(+id, is_repeat, req.user);
  }

  @Post('import')
  @UseInterceptors(FileInterceptor('file'))
  @Permission('cong-no', 'create')
  async importExcel(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      return {
        imported: [],
        errors: [{ row: 0, error: 'Không có file upload' }],
      };
    }
    // Đọc file excel, parse rows
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.buffer);
    const worksheet = workbook.worksheets[0];
    const rows: Record<string, any>[] = [];
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return; // Bỏ qua header nếu cần
      const rowData: Record<string, any> = {};
      worksheet.getRow(1).eachCell((cell, colNumber) => {
        rowData[cell.value as string] = row.getCell(colNumber).value;
      });
      rows.push(rowData);
    });
    return this.debtConfigService.importExcelRows(rows);
  }
}
