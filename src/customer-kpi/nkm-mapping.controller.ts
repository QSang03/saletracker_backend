import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../common/guards/permission.guard';
import { Permission } from '../common/guards/permission.decorator';
import { NkmMappingService } from './nkm-mapping.service';
import { NkmSyncService } from './nkm-sync.service';

/**
 * API quản trị bảng tra mã + đồng bộ NKM.
 *
 * Bảng tra mã là chỗ DUY NHẤT có `slpCode` (mã nội bộ NKM) — không có nó thì
 * không lấy được doanh thu theo sale, nên việc nạp file `bang_ma_doiCHieu.xlsx`
 * là bước bắt buộc trước khi module doanh số chạy được.
 */
@Controller('nkm-mapping')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class NkmMappingController {
  constructor(
    private readonly mapping: NkmMappingService,
    private readonly sync: NkmSyncService,
  ) {}

  /** Nạp/cập nhật bảng tra mã từ file Excel của lead. */
  @Post('import')
  @Permission('khach-hang', 'import')
  @UseInterceptors(FileInterceptor('file'))
  import(@UploadedFile() file: any) {
    if (!file) throw new BadRequestException('Thiếu file Excel bảng tra mã');
    return this.mapping.importFromExcel(file);
  }

  @Get('sales')
  @Permission('khach-hang', 'read')
  async sales() {
    const rows = await this.mapping.listSales();
    return { data: rows, total: rows.length };
  }

  @Get('groups')
  @Permission('khach-hang', 'read')
  async groups() {
    const rows = await this.mapping.listGroups();
    return { data: rows, total: rows.length };
  }

  /**
   * Đối chiếu bảng tra với API quý — nhân viên có doanh số trong NKM nhưng chưa
   * có trong bảng tra (cần nạp lại file) và nhãn bị đổi tên.
   */
  @Get('audit')
  @Permission('khach-hang', 'read')
  audit() {
    return this.sync.auditSaleMap();
  }

  /**
   * Chốt doanh thu một ngày theo từng sale — dùng để chạy tay hoặc bù ngày hụt.
   * Không truyền `day` thì đồng bộ hôm nay (số tạm, SAP còn nạp dở).
   */
  @Post('sync-revenue')
  @Permission('khach-hang', 'import')
  @HttpCode(HttpStatus.OK)
  syncRevenue(@Query('day') day: string | undefined) {
    if (day !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      throw new BadRequestException('day phải có dạng YYYY-MM-DD');
    }
    return this.sync.syncRevenueDay(day);
  }

  /** Chốt chỉ tiêu quý. Mặc định năm tài chính hiện tại, `force` bỏ qua cache. */
  @Post('sync-quarter')
  @Permission('khach-hang', 'import')
  @HttpCode(HttpStatus.OK)
  syncQuarter(
    @Query('year') year: string | undefined,
    @Query('force') force: string | undefined,
  ) {
    return this.sync.syncQuarterTargets({
      year: year ? Number(year) : undefined,
      force: force === 'true',
    });
  }

  /**
   * Ngày còn hụt dữ liệu trong khoảng — để admin biết còn thiếu ngày nào trước
   * khi xem báo cáo. Không truyền gì = soi 30 ngày gần nhất.
   */
  @Get('missing-days')
  @Permission('khach-hang', 'read')
  missingDays(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
  ) {
    return this.sync.missingDays(from, to);
  }
}
