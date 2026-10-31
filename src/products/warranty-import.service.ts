import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as ExcelJS from 'exceljs';
import { Product } from './product.entity';
import { ProductWarrantyImporter } from './product-warranty-importer.entity';
import { User } from '../users/user.entity';
import { getRoleNames } from '../common/utils/user-permission.helper';

/**
 * Nạp thời gian bảo hành (theo THÁNG) cho sản phẩm từ file Excel.
 *
 * API nguồn (VNK) không có thông tin bảo hành nên dữ liệu chỉ vào được qua
 * file nạp tay. File gồm 2 cột:
 *   - "MÃ HT": mã sản phẩm (products.product_code, KHÔNG phải id)
 *   - "TGBH" : thời gian bảo hành — đúng 1 con số, đơn vị tháng
 *
 * Quy tắc xử lý từng dòng:
 *   - Không có mã            → bỏ qua im lặng (đếm vào skipped_empty_code)
 *   - Có mã, không tra được  → cảnh báo "không tìm thấy sản phẩm"
 *   - Có mã, TGBH sai        → cảnh báo (trống / không phải số nguyên / ngoài 0..600)
 *   - Có mã, TGBH hợp lệ     → cập nhật warranty_months + warranty_updated_at
 */

export interface WarrantyImportWarning {
  /** Số dòng Excel thực (1-based). */
  row: number;
  /** Mã HT đọc được từ dòng (null nếu dòng không có mã). */
  code: string | null;
  message: string;
}

export interface WarrantyImportResult {
  /** Tổng số dòng dữ liệu (không tính dòng header). */
  totalRows: number;
  /** Số mã hợp lệ đã được cập nhật vào sản phẩm. */
  updated: number;
  /** Số dòng bỏ qua vì không có mã. */
  skippedEmptyCode: number;
  /** Số dòng có mã nhưng không tra được sản phẩm. */
  notFoundCount: number;
  /** Số dòng có mã nhưng TGBH không hợp lệ. */
  invalidCount: number;
  /** Số mã xuất hiện nhiều lần trong file. */
  duplicateCodeCount: number;
  warnings: WarrantyImportWarning[];
  warningsTruncated: boolean;
}

/** Cột "MÃ HT" sau khi chuẩn hoá header (bỏ dấu, in hoa, gộp khoảng trắng). */
const CODE_HEADER = 'MA HT';
/** Cột "TGBH" sau khi chuẩn hoá. */
const MONTHS_HEADER = 'TGBH';

/** Số dòng đầu tiên được quét để tìm dòng header. */
const HEADER_SCAN_ROWS = 15;

/** Giới hạn số cảnh báo trả về — phần còn lại chỉ đếm. */
const MAX_WARNINGS = 300;

/** Chặn trên hợp lý của số tháng bảo hành (50 năm). */
const MAX_WARRANTY_MONTHS = 600;

/**
 * Đọc giá trị ô về chuỗi — chỉ nhận primitive (string/number/boolean/bigint);
 * richText/công thức/hyperlink được xử lý riêng ở `cellText`, mọi object khác
 * coi như rỗng thay vì in ra "[object Object]".
 */
const toStr = (v: unknown): string => {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'bigint') return v.toString();
  return '';
};

/** Chuẩn hoá mã / header: bỏ dấu (NFD), gộp khoảng trắng, in hoa. */
const norm = (v: unknown): string =>
  toStr(v)
    .replace(/[Đđ]/g, 'D')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

/** Đọc giá trị ô về chuỗi — xử lý richText, công thức (lấy result nếu có). */
function cellText(cell: ExcelJS.Cell): string {
  const v: unknown = cell.value;
  if (v == null || typeof v !== 'object') {
    return toStr(v).trim();
  }
  if (
    'richText' in v &&
    Array.isArray((v as { richText?: unknown }).richText)
  ) {
    return (
      (v as { richText: unknown[] }).richText
        .map((part) => cellTextOf(part))
        .join('') ?? ''
    );
  }
  if ('result' in v) {
    return toStr((v as { result?: unknown }).result).trim();
  }
  if ('text' in v) {
    return toStr((v as { text?: unknown }).text).trim();
  }
  return '';
}

/** Một phần richText: `{ text: string }` hoặc giá trị thô. */
function cellTextOf(part: unknown): string {
  if (part != null && typeof part === 'object' && 'text' in part) {
    return toStr((part as { text?: unknown }).text);
  }
  return toStr(part);
}

interface ParsedRow {
  rowNum: number;
  normCode: string;
  rawCode: string;
  months: number | null;
  monthsError: string | null;
}

@Injectable()
export class WarrantyImportService {
  private readonly logger = new Logger(WarrantyImportService.name);

  constructor(
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(ProductWarrantyImporter)
    private readonly importerRepo: Repository<ProductWarrantyImporter>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  // ------------------------------------------------- danh sách được chỉ định

  /** User có trong danh sách được chỉ định nạp file bảo hành? */
  async isImporter(userId: number | undefined | null): Promise<boolean> {
    if (!userId || !Number.isFinite(Number(userId))) return false;
    const row = await this.importerRepo.findOne({
      where: { userId: Number(userId) },
    });
    return Boolean(row);
  }

  /**
   * Tự tra quyền của user hiện tại — nguồn cho FE ẩn/hiện nút "Nạp bảo hành"
   * mà không cần gọi thử endpoint import rồi ăn 403.
   */
  async getMyImportPermission(
    user:
      | {
          id?: number;
          roles?: unknown[];
        }
      | null
      | undefined,
  ) {
    const isAdmin = getRoleNames(user)
      .map((role) => String(role).toLowerCase())
      .includes('admin');
    const designated = await this.isImporter(user?.id);
    return { isAdmin, designated, allowed: isAdmin || designated };
  }

  /** Danh sách người được chỉ định — kèm thông tin user để vẽ bảng. */
  async listImporters() {
    const rows = await this.importerRepo.find({
      relations: ['user', 'user.roles'],
      order: { createdAt: 'DESC' },
    });
    return rows.map((row) => ({
      userId: row.userId,
      fullName: row.user?.fullName ?? null,
      username: row.user?.username ?? null,
      employeeCode: row.user?.employeeCode ?? null,
      roles: (row.user?.roles ?? []).map((role) => role.name),
      createdBy: row.createdBy ?? null,
      createdAt: row.createdAt,
    }));
  }

  /**
   * Admin chỉ định thêm 1 user. Idempotent: user đã có trong danh sách thì
   * trả về hiện trạng, không báo lỗi.
   */
  async addImporter(userId: number, createdBy?: number | null) {
    if (!userId || !Number.isFinite(Number(userId))) {
      throw new BadRequestException('userId không hợp lệ');
    }
    const user = await this.userExists(Number(userId));
    if (!user) {
      throw new BadRequestException(`Không tìm thấy user id=${userId}`);
    }

    const existing = await this.importerRepo.findOne({
      where: { userId: Number(userId) },
    });
    if (existing) {
      return { userId: Number(userId), alreadyAdded: true };
    }

    await this.importerRepo.insert({
      userId: Number(userId),
      createdBy: createdBy ?? null,
    });
    this.logger.log(
      `User ${userId} được chỉ định nạp file bảo hành (bởi ${createdBy ?? 'n/a'})`,
    );
    return { userId: Number(userId), alreadyAdded: false };
  }

  /** Admin gỡ chỉ định. */
  async removeImporter(userId: number) {
    if (!userId || !Number.isFinite(Number(userId))) {
      throw new BadRequestException('userId không hợp lệ');
    }
    const result = await this.importerRepo.delete({ userId: Number(userId) });
    return { userId: Number(userId), removed: (result.affected ?? 0) > 0 };
  }

  private async userExists(userId: number): Promise<boolean> {
    // password có select:false nên find an toàn.
    const user = await this.userRepo.findOne({ where: { id: userId } });
    return Boolean(user);
  }

  async importFromExcel(
    file: Express.Multer.File,
  ): Promise<WarrantyImportResult> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('File Excel rỗng hoặc không đọc được');
    }

    const workbook = new ExcelJS.Workbook();
    try {
      // exceljs khai báo Buffer riêng (extends ArrayBuffer) nên cast tường minh.
      await workbook.xlsx.load(file.buffer as unknown as ExcelJS.Buffer);
    } catch {
      throw new BadRequestException(
        'File không đúng định dạng .xlsx — hãy lưu lại từ Excel dưới dạng .xlsx rồi nạp lại',
      );
    }

    const location = this.locateHeader(workbook);
    const parsed = this.parseSheet(location.sheet, location);
    const productsByCode = await this.loadProductCodeMap(
      parsed.rows.map((r) => r.normCode),
    );

    const warnings: WarrantyImportWarning[] = [];
    const pushWarning = (w: WarrantyImportWarning) => {
      if (warnings.length < MAX_WARNINGS) warnings.push(w);
    };

    let notFoundCount = 0;
    let invalidCount = 0;

    // Mã hợp lệ → số tháng. Dòng sau ghi đè dòng trước (last wins) kèm cảnh báo.
    const validByCode = new Map<
      string,
      { months: number; rowNum: number; rawCode: string }
    >();
    const seen = new Map<string, number[]>(); // normCode → các dòng xuất hiện

    for (const row of parsed.rows) {
      const rowNums = seen.get(row.normCode);
      if (rowNums) {
        rowNums.push(row.rowNum);
      } else {
        seen.set(row.normCode, [row.rowNum]);
      }

      if (row.months === null) {
        invalidCount += 1;
        pushWarning({
          row: row.rowNum,
          code: row.rawCode,
          message: row.monthsError || 'TGBH không hợp lệ',
        });
        continue;
      }

      validByCode.set(row.normCode, {
        months: row.months,
        rowNum: row.rowNum,
        rawCode: row.rawCode,
      });
    }

    for (const [normCode, rowNums] of seen) {
      if (rowNums.length > 1) {
        pushWarning({
          row: rowNums[0],
          code: validByCode.get(normCode)?.rawCode ?? null,
          message: `Mã xuất hiện ${rowNums.length} lần trong file (dòng ${rowNums.join(
            ', ',
          )}) — giá trị dòng cuối được dùng`,
        });
      }
    }

    // Tra mã → gom id sản phẩm theo nhóm số tháng để update theo lô.
    let updated = 0;
    const monthsToIds = new Map<number, number[]>();
    for (const [normCode, valid] of validByCode) {
      const productIds = productsByCode.get(normCode);
      if (!productIds || productIds.length === 0) {
        notFoundCount += 1;
        pushWarning({
          row: valid.rowNum,
          code: valid.rawCode,
          message: `Không tìm thấy sản phẩm với mã HT "${valid.rawCode}"`,
        });
        continue;
      }
      const ids = monthsToIds.get(valid.months) ?? [];
      ids.push(...productIds);
      monthsToIds.set(valid.months, ids);
      updated += 1;
    }

    const updatedAt = new Date();
    for (const [months, ids] of monthsToIds) {
      for (let i = 0; i < ids.length; i += 500) {
        await this.productRepo
          .createQueryBuilder()
          .update(Product)
          .set({ warrantyMonths: months, warrantyUpdatedAt: updatedAt })
          .where('id IN (:...ids)', { ids: ids.slice(i, i + 500) })
          .execute();
      }
    }

    this.logger.log(
      `Import bảo hành: ${parsed.totalRows} dòng, cập nhật ${updated} mã, ` +
        `bỏ qua ${parsed.skippedEmptyCode} dòng không mã, không tìm thấy ${notFoundCount}, ` +
        `TGBH sai ${invalidCount}`,
    );

    return {
      totalRows: parsed.totalRows,
      updated,
      skippedEmptyCode: parsed.skippedEmptyCode,
      notFoundCount,
      invalidCount,
      duplicateCodeCount: Array.from(seen.values()).filter(
        (rows) => rows.length > 1,
      ).length,
      warnings,
      warningsTruncated: warnings.length >= MAX_WARNINGS,
    };
  }

  /** Sinh file mẫu .xlsx: sheet dữ liệu 2 cột + sheet hướng dẫn. */
  async buildTemplate(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('BAO HANH');
    sheet.getColumn(1).width = 24;
    sheet.getColumn(2).width = 12;
    sheet.addRow(['MÃ HT', 'TGBH']);
    sheet.addRow(['KV-2366', 12]);
    sheet.addRow(['ABC-1234', 24]);

    const guide = workbook.addWorksheet('HUONG DAN');
    guide.getColumn(1).width = 110;
    const notes = [
      'HƯỚNG DẪN NẠP THỜI GIAN BẢO HÀNH',
      '1. Điền dữ liệu ở sheet "BAO HANH", xoá 2 dòng ví dụ trước khi nạp.',
      '2. Cột "MÃ HT": mã sản phẩm (product_code), KHÔNG phải id. Dòng không có mã sẽ bị bỏ qua.',
      '3. Cột "TGBH": thời gian bảo hành — đúng 1 con số, đơn vị THÁNG (ví dụ 12 = 12 tháng).',
      '4. TGBH phải là số nguyên từ 0 đến 600. "12.5", "12 tháng", "1 năm" đều bị báo lỗi.',
      '5. Mã không có trong hệ thống sẽ được liệt kê trong cảnh báo sau khi nạp.',
      '6. Chỉ hỗ trợ định dạng .xlsx.',
    ];
    for (const note of notes) guide.addRow([note]);

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  // -------------------------------------------------------------- đọc file

  /**
   * Quét các sheet tìm dòng header chứa cả 2 cột "MÃ HT" và "TGBH" (không
   * phân biệt dấu/hoa thường/khoảng trắng; header có thể không nằm ở dòng 1).
   */
  private locateHeader(workbook: ExcelJS.Workbook): {
    sheet: ExcelJS.Worksheet;
    headerRow: number;
    colCode: number;
    colMonths: number;
  } {
    for (const sheet of workbook.worksheets) {
      const lastScanRow = Math.min(
        HEADER_SCAN_ROWS,
        sheet.rowCount || HEADER_SCAN_ROWS,
      );
      for (let r = 1; r <= lastScanRow; r += 1) {
        const row = sheet.getRow(r);
        let colCode: number | undefined;
        let colMonths: number | undefined;
        row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
          const header = norm(cellText(cell));
          if (header === CODE_HEADER) colCode = colNumber;
          else if (header === MONTHS_HEADER) colMonths = colNumber;
        });
        if (colCode !== undefined && colMonths !== undefined) {
          return { sheet, headerRow: r, colCode, colMonths };
        }
      }
    }
    throw new BadRequestException(
      'Không tìm thấy 2 cột "MÃ HT" và "TGBH" trong file — cột 1 phải là "MÃ HT" (mã sản phẩm), cột 2 là "TGBH" (số tháng bảo hành)',
    );
  }

  /** Đọc toàn bộ dòng dữ liệu — dòng không có mã được đếm rồi bỏ qua. */
  private parseSheet(
    sheet: ExcelJS.Worksheet,
    location: { headerRow: number; colCode: number; colMonths: number },
  ) {
    const rows: ParsedRow[] = [];
    let skippedEmptyCode = 0;

    sheet.eachRow((row, rowNum) => {
      if (rowNum <= location.headerRow) return;

      const rawCode = cellText(row.getCell(location.colCode));
      const rawMonths = cellText(row.getCell(location.colMonths));

      if (!rawCode) {
        skippedEmptyCode += 1;
        return;
      }

      const months = this.parseMonths(rawMonths);
      rows.push({
        rowNum,
        normCode: norm(rawCode),
        rawCode,
        months: months.value,
        monthsError: months.error,
      });
    });

    return { rows, totalRows: rows.length, skippedEmptyCode };
  }

  /**
   * TGBH phải là số nguyên 0..600 (đơn vị tháng). "12" hợp lệ, "12.5",
   * "12 tháng", "1 năm"… không hợp lệ.
   */
  private parseMonths(raw: string): {
    value: number | null;
    error: string | null;
  } {
    if (!raw) {
      return { value: null, error: 'TGBH để trống' };
    }
    const parsed = Number(raw.replace(/,/g, '.'));
    if (!Number.isFinite(parsed)) {
      return {
        value: null,
        error: `TGBH "${raw}" không phải là số (cần số nguyên, đơn vị tháng)`,
      };
    }
    if (!Number.isInteger(parsed)) {
      return {
        value: null,
        error: `TGBH "${raw}" không phải số nguyên (đơn vị tháng, ví dụ 12)`,
      };
    }
    if (parsed < 0 || parsed > MAX_WARRANTY_MONTHS) {
      return {
        value: null,
        error: `TGBH "${raw}" ngoài khoảng cho phép 0..${MAX_WARRANTY_MONTHS} tháng`,
      };
    }
    return { value: parsed, error: null };
  }

  /** Map mã chuẩn hoá → các id sản phẩm trong DB (xử lý cả trùng mã). */
  private async loadProductCodeMap(
    codes: string[],
  ): Promise<Map<string, number[]>> {
    if (codes.length === 0) return new Map();

    const rows = await this.productRepo.find({
      select: ['id', 'productCode'],
    });
    const map = new Map<string, number[]>();
    const wanted = new Set(codes);
    for (const row of rows) {
      const key = norm(row.productCode);
      if (!wanted.has(key)) continue;
      const ids = map.get(key) ?? [];
      ids.push(row.id);
      map.set(key, ids);
    }
    return map;
  }
}
