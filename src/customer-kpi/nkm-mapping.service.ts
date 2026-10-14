import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as ExcelJS from 'exceljs';
import { employeeCodeOfLabel, saleNameOfLabel } from './nkm-label';
import { NkmSaleMap } from './nkm-sale-map.entity';
import { NkmGroupMap } from './nkm-group-map.entity';

/**
 * Bảng tra mã NKM ↔ hệ thống (thiết kế §3.1).
 *
 * Nguồn duy nhất có `slpCode` là file `bang_ma_doiCHieu.xlsx` — API chỉ tiêu
 * quý không trả slpCode còn API doanh thu lại bắt buộc slpCode. Sheet `NV_sale`
 * cho bảng tra nhân viên, sheet `Nhom Hang Key None` cho bảng tra nhóm hàng.
 *
 * Phòng ban trong file là mã `KD-*`; chỉ 6 mã ứng với 6 phòng kinh doanh đang
 * chạy KPI, các mã còn lại (`KD-ON`, `KD-ADMIN`, `KD-ADMINLETAN`) lưu `dept_slug`
 * rỗng để sau này có phòng mới thì bảng tra vẫn đủ, báo cáo không nhảy số.
 */

/** Mã phòng ban trong file tra mã → slug phòng ban của module khách hàng. */
export const NKM_DEPT_SLUGS: Record<string, string> = {
  'KD-MAYINMUCIN': 'may-in',
  'KD-PCLCDSVWKS': 'pc',
  'KD-PTTT': 'linh-kien',
  'KD-LAPTOP': 'laptop',
  'KD-PTKH1': 'ptkh1',
  'KD-PTKH2': 'ptkh2',
};

/** Sheet chứa bảng tra nhân viên / nhóm hàng (tên sheet có thể có dấu cách lạ). */
const SALE_SHEET = 'NV_sale';
const GROUP_SHEET = 'Nhom Hang Key None';

/** Chuẩn hoá header để khớp tên cột bất chất Unicode và khoảng trắng. */
function normHeader(value: unknown): string {
  return String(primitive(value) ?? '')
    .replace(/[Đđ]/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

@Injectable()
export class NkmMappingService {
  private readonly logger = new Logger(NkmMappingService.name);

  constructor(
    @InjectRepository(NkmSaleMap)
    private readonly saleMapRepo: Repository<NkmSaleMap>,
    @InjectRepository(NkmGroupMap)
    private readonly groupMapRepo: Repository<NkmGroupMap>,
  ) {}

  /** Bảng tra nhân viên đang bật — job đồng bộ duyệt qua đây. */
  async listSales(): Promise<NkmSaleMap[]> {
    return this.saleMapRepo.find({
      where: { is_active: true },
      order: { slp_code: 'ASC' },
    });
  }

  async listGroups(): Promise<NkmGroupMap[]> {
    return this.groupMapRepo.find({ order: { grp_id: 'ASC' } });
  }

  /** `slp_code` của các sale đang bật — dùng khi nạp doanh thu. */
  async activeSlpCodes(): Promise<number[]> {
    const rows = await this.saleMapRepo.find({
      where: { is_active: true },
      select: ['slp_code'],
    });
    return rows.map((row) => row.slp_code);
  }

  /** `slp_code` theo mã nhân viên — dùng khi nối dữ liệu với user trong hệ. */
  async slpCodesByEmployeeCode(): Promise<Map<string, number[]>> {
    const result = new Map<string, number[]>();
    for (const row of await this.listSales()) {
      const list = result.get(row.employee_code) ?? [];
      list.push(row.slp_code);
      result.set(row.employee_code, list);
    }
    return result;
  }

  /**
   * Nạp/cập nhật bảng tra từ file Excel. Idempotent: chạy lại cùng file cho
   * cùng kết quả; mã còn trong file thì bật lại, mã không còn thì tắt chứ không
   * xoá (bảng doanh thu và chỉ tiêu đang trỏ tới `slp_code`).
   */
  async importFromExcel(file: { buffer: Buffer }): Promise<{
    sales: number;
    groups: number;
    deactivatedSales: number;
  }> {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(file.buffer as any);
    } catch {
      throw new BadRequestException(
        'Không đọc được file Excel — kiểm tra lại file bảng tra mã',
      );
    }

    const saleSheet = this.findSheet(workbook, SALE_SHEET);
    const groupSheet = this.findSheet(workbook, GROUP_SHEET);
    if (!saleSheet) {
      throw new BadRequestException(
        `Thiếu sheet "${SALE_SHEET}" — file phải là bang_ma_doiCHieu.xlsx`,
      );
    }

    const sales = this.readSaleSheet(saleSheet);
    const groups = groupSheet ? this.readGroupSheet(groupSheet) : [];

    for (let i = 0; i < sales.length; i += 200) {
      const chunk = sales.slice(i, i + 200);
      await this.saleMapRepo
        .createQueryBuilder()
        .insert()
        .into(NkmSaleMap)
        .values(chunk)
        .orUpdate({
          overwrite: [
            'sale_label',
            'employee_code',
            'sale_name',
            'dept_code',
            'dept_slug',
            'is_active',
          ],
        })
        .execute();
    }
    for (let i = 0; i < groups.length; i += 200) {
      const chunk = groups.slice(i, i + 200);
      await this.groupMapRepo
        .createQueryBuilder()
        .insert()
        .into(NkmGroupMap)
        .values(chunk)
        .orUpdate({ overwrite: ['group_name'] })
        .execute();
    }

    const keep = new Set(sales.map((row) => row.slp_code));
    const current = await this.saleMapRepo.find({ select: ['id', 'slp_code'] });
    const stale = current.filter((row) => !keep.has(row.slp_code));
    if (stale.length > 0) {
      await this.saleMapRepo.update(
        stale.map((row) => row.id),
        { is_active: false },
      );
    }

    this.logger.log(
      `Bảng tra NKM: ${sales.length} nhân viên, ${groups.length} nhóm hàng, tắt ${stale.length} mã không còn trong file`,
    );
    return {
      sales: sales.length,
      groups: groups.length,
      deactivatedSales: stale.length,
    };
  }

  // -------------------------------------------------------------- đọc sheet

  /** Tìm sheet theo tên, không phân biệt hoa/thường và khoảng trắng. */
  private findSheet(workbook: ExcelJS.Workbook, name: string) {
    const target = normHeader(name);
    for (const worksheet of workbook.worksheets) {
      if (normHeader(worksheet.name) === target) return worksheet;
    }
    return undefined;
  }

  /**
   * Sheet nhân viên: `Mã | Tên | Department`. Dòng thiếu mã hoặc tên bỏ qua
   * (hàng tổng/kẻ bảng cuối file).
   */
  private readSaleSheet(worksheet: ExcelJS.Worksheet): Partial<NkmSaleMap>[] {
    const header = this.readHeader(worksheet);
    const colCode = header.columns.get('MA');
    const colLabel = header.columns.get('TEN');
    const colDept = header.columns.get('DEPARTMENT');
    if (colCode === undefined || colLabel === undefined) {
      throw new BadRequestException(
        `Sheet "${SALE_SHEET}" thiếu cột "Mã" hoặc "Tên"`,
      );
    }
    const rows: Partial<NkmSaleMap>[] = [];
    const seen = new Set<number>();
    worksheet.eachRow((row, index) => {
      if (index === header.rowIndex) return;
      const rawCode = row.getCell(colCode).value;
      const label = text(row.getCell(colLabel).value);
      if (!label || rawCode === null || rawCode === undefined) return;
      const slpCode = Number(rawCode);
      if (!Number.isFinite(slpCode) || seen.has(slpCode)) return;
      seen.add(slpCode);
      const deptCode =
        colDept !== undefined ? text(row.getCell(colDept).value) : null;
      rows.push({
        slp_code: slpCode,
        sale_label: label,
        employee_code: employeeCodeOfLabel(label),
        sale_name: saleNameOfLabel(label),
        dept_code: deptCode,
        dept_slug: deptCode
          ? (NKM_DEPT_SLUGS[deptCode.toUpperCase()] ?? null)
          : null,
        is_active: true,
      });
    });
    return rows;
  }

  /** Sheet nhóm hàng: `Mã | Tên`. */
  private readGroupSheet(worksheet: ExcelJS.Worksheet): Partial<NkmGroupMap>[] {
    const header = this.readHeader(worksheet);
    const colCode = header.columns.get('MA');
    const colName = header.columns.get('TEN');
    if (colCode === undefined || colName === undefined) {
      throw new BadRequestException(
        `Sheet "${GROUP_SHEET}" thiếu cột "Mã" hoặc "Tên"`,
      );
    }
    const rows: Partial<NkmGroupMap>[] = [];
    const seen = new Set<number>();
    worksheet.eachRow((row, index) => {
      if (index === header.rowIndex) return;
      const rawCode = row.getCell(colCode).value;
      const name = text(row.getCell(colName).value);
      if (!name || rawCode === null || rawCode === undefined) return;
      const grpId = Number(rawCode);
      if (!Number.isFinite(grpId) || seen.has(grpId)) return;
      seen.add(grpId);
      rows.push({ grp_id: grpId, group_name: name });
    });
    return rows;
  }

  /** Vị trí cột theo tên chuẩn hoá của dòng header đầu tiên có dữ liệu. */
  private readHeader(worksheet: ExcelJS.Worksheet): {
    rowIndex: number;
    columns: Map<string, number>;
  } {
    const columns = new Map<string, number>();
    let rowIndex = 1;
    for (let r = 1; r <= Math.min(worksheet.rowCount, 20); r += 1) {
      const row = worksheet.getRow(r);
      for (let c = 1; c <= worksheet.columnCount; c += 1) {
        const name = normHeader(row.getCell(c).value);
        if (name && !columns.has(name)) columns.set(name, c);
      }
      if (columns.size > 0) {
        rowIndex = r;
        break;
      }
    }
    return { rowIndex, columns };
  }
}

/** Giá trị ô Excel dạng số/chữ — còn lại (ảnh, công thức, ngày...) trả null. */
const primitive = (value: unknown): string | number | boolean | null => {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  return null;
};

const text = (value: unknown): string | null => {
  const raw = primitive(value);
  if (raw === null) return null;
  const str = String(raw).trim();
  return str ? str : null;
};
