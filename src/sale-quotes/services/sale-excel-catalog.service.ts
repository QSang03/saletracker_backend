import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, DataSource, Like } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import * as ExcelJS from 'exceljs';
import { SaleExcelCatalog } from '../entities/sale-excel-catalog.entity';
import { SaleExcelSheet } from '../entities/sale-excel-sheet.entity';
import { SaleExcelItem } from '../entities/sale-excel-item.entity';
import { SaleExcelPermission } from '../entities/sale-excel-permission.entity';
import { Product } from '../../products/product.entity';
import { User } from '../../users/user.entity';
import {
  SaleExcelParserService,
  ParsedItemRow,
} from './sale-excel-parser.service';

export interface UserPermissionDto {
  userId: number;
  canUpload: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}

@Injectable()
export class SaleExcelCatalogService {
  private readonly logger = new Logger(SaleExcelCatalogService.name);

  constructor(
    @InjectRepository(SaleExcelCatalog)
    private readonly catalogRepo: Repository<SaleExcelCatalog>,
    @InjectRepository(SaleExcelSheet)
    private readonly sheetRepo: Repository<SaleExcelSheet>,
    @InjectRepository(SaleExcelItem)
    private readonly itemRepo: Repository<SaleExcelItem>,
    @InjectRepository(SaleExcelPermission)
    private readonly permissionRepo: Repository<SaleExcelPermission>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly parserService: SaleExcelParserService,
    private readonly dataSource: DataSource,
  ) {}

  // =========================================================================
  // KIỂM TRA PHÂN QUYỀN
  // =========================================================================
  async checkUserPermission(
    userId: number,
    action: 'upload' | 'update' | 'delete',
    userRoles?: { name: string }[],
  ): Promise<boolean> {
    const isAdmin = userRoles?.some(
      (r) => r.name === 'admin' || r.name === 'Super Admin',
    );
    if (isAdmin) return true;

    const perm = await this.permissionRepo.findOne({ where: { userId } });
    if (!perm) return false;

    if (action === 'upload') return !!perm.canUpload;
    if (action === 'update') return !!perm.canUpdate;
    if (action === 'delete') return !!perm.canDelete;
    return false;
  }

  async getMyPermissions(userId: number, userRoles?: { name: string }[]) {
    const isAdmin = !!userRoles?.some(
      (r) => r.name === 'admin' || r.name === 'Super Admin',
    );
    if (isAdmin) {
      return {
        canUpload: true,
        canUpdate: true,
        canDelete: true,
        isAdmin: true,
      };
    }

    const perm = await this.permissionRepo.findOne({ where: { userId } });
    return {
      canUpload: perm?.canUpload ?? false,
      canUpdate: perm?.canUpdate ?? false,
      canDelete: perm?.canDelete ?? false,
      isAdmin: false,
    };
  }

  async getAllPermissions() {
    const users = await this.userRepo.find({
      select: ['id', 'username', 'fullName', 'email', 'status'],
      relations: ['roles', 'departments'],
      order: { fullName: 'ASC' },
    });

    const perms = await this.permissionRepo.find();
    const permMap = new Map<number, SaleExcelPermission>();
    perms.forEach((p) => permMap.set(p.userId, p));

    return users.map((u) => {
      const p = permMap.get(u.id);
      const isAdmin = u.roles?.some(
        (r) => r.name === 'admin' || r.name === 'Super Admin',
      );
      return {
        userId: u.id,
        username: u.username,
        fullName: u.fullName || u.username,
        email: u.email,
        roles: u.roles?.map((r) => r.name) || [],
        departments: u.departments?.map((d) => d.name) || [],
        canUpload: isAdmin ? true : (p?.canUpload ?? false),
        canUpdate: isAdmin ? true : (p?.canUpdate ?? false),
        canDelete: isAdmin ? true : (p?.canDelete ?? false),
        isAdmin: !!isAdmin,
      };
    });
  }

  async savePermissions(
    permissions: UserPermissionDto[],
    assignedByUserId: number,
  ) {
    for (const p of permissions) {
      let existing = await this.permissionRepo.findOne({
        where: { userId: p.userId },
      });
      if (!existing) {
        existing = this.permissionRepo.create({
          userId: p.userId,
          canUpload: p.canUpload,
          canUpdate: p.canUpdate,
          canDelete: p.canDelete,
          assignedByUserId,
        });
      } else {
        existing.canUpload = p.canUpload;
        existing.canUpdate = p.canUpdate;
        existing.canDelete = p.canDelete;
        existing.assignedByUserId = assignedByUserId;
      }
      await this.permissionRepo.save(existing);
    }
    return { success: true };
  }

  // =========================================================================
  // UPLOAD CATALOG MỚI
  // =========================================================================
  async uploadCatalog(
    file: Express.Multer.File,
    templateType: number,
    customName?: string,
    user?: { id: number; roles?: { name: string }[] },
  ) {
    if (!file) {
      throw new BadRequestException('Vui lòng chọn file Excel');
    }

    const hasPerm = await this.checkUserPermission(
      user?.id || 0,
      'upload',
      user?.roles,
    );
    if (!hasPerm) {
      throw new ForbiddenException('Bạn không có quyền tải lên file Excel');
    }

    const cleanName = (customName || file.originalname.replace(/\.[^/.]+$/, ''))
      .trim();

    // Parse Excel Buffer trực tiếp từ bộ nhớ
    const parsed = await this.parserService.parseBuffer(
      file.buffer,
      templateType,
    );
    if (parsed.sheets.length === 0 || parsed.totalItems === 0) {
      throw new BadRequestException(
        'Không tìm thấy dữ liệu hợp lệ trong file Excel theo mẫu đã chọn',
      );
    }

    // Matching kho S1
    const s1Map = await this.batchMatchInventory(parsed.sheets);

    // Lưu vào database trong Transaction
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const catalog = queryRunner.manager.create(SaleExcelCatalog, {
        name: cleanName,
        originalFileName: file.originalname,
        filePath: null,
        fileSize: file.size,
        templateType: Number(templateType),
        totalSheets: parsed.totalSheets,
        totalItems: parsed.totalItems,
        createdByUserId: user?.id,
        updatedByUserId: user?.id,
      });
      const savedCatalog = await queryRunner.manager.save(catalog);

      for (const s of parsed.sheets) {
        const sheet = queryRunner.manager.create(SaleExcelSheet, {
          catalogId: savedCatalog.id,
          sheetName: s.sheetName,
          sheetIndex: s.sheetIndex,
          itemCount: s.items.length,
        });
        const savedSheet = await queryRunner.manager.save(sheet);

        const itemEntities = s.items.map((i) => {
          const s1 = s1Map.get(i.productCode.toUpperCase());
          return queryRunner.manager.create(SaleExcelItem, {
            catalogId: savedCatalog.id,
            sheetId: savedSheet.id,
            rowIndex: i.rowIndex,
            productCode: i.productCode,
            productName: i.productName,
            modelName: i.modelName || null,
            warranty: i.warranty || null,
            price: i.price,
            rawStatus: i.rawStatus || null,
            s1Matched: !!s1,
            s1ProductId: s1 ? s1.id : null,
            s1StockQuantity: s1 ? (s1.stock ?? 0) : null,
            isCustom: !s1,
          });
        });

        // Insert batch chunk 500
        const chunkSize = 500;
        for (let idx = 0; idx < itemEntities.length; idx += chunkSize) {
          await queryRunner.manager.save(
            itemEntities.slice(idx, idx + chunkSize),
          );
        }
      }

      await queryRunner.commitTransaction();

      return {
        id: savedCatalog.id,
        name: savedCatalog.name,
        totalSheets: savedCatalog.totalSheets,
        totalItems: savedCatalog.totalItems,
      };
    } catch (err) {
      await queryRunner.rollbackTransaction();
      this.logger.error('Lỗi khi lưu dữ liệu Excel catalog', err);
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  // =========================================================================
  // RE-UPLOAD (NẠP ĐÈ FILE MỚI)
  // =========================================================================
  async reuploadCatalog(
    catalogId: number,
    file: Express.Multer.File,
    templateType?: number,
    user?: { id: number; roles?: { name: string }[] },
  ) {
    const catalog = await this.catalogRepo.findOne({
      where: { id: catalogId },
    });
    if (!catalog) {
      throw new NotFoundException('Không tìm thấy danh mục bảng giá');
    }

    const hasPerm = await this.checkUserPermission(
      user?.id || 0,
      'update',
      user?.roles,
    );
    if (!hasPerm) {
      throw new ForbiddenException('Bạn không có quyền cập nhật bảng giá này');
    }

    const tType = templateType ? Number(templateType) : catalog.templateType;

    // Parse Excel Buffer
    const parsed = await this.parserService.parseBuffer(file.buffer, tType);
    if (parsed.sheets.length === 0 || parsed.totalItems === 0) {
      throw new BadRequestException(
        'Không tìm thấy dữ liệu hợp lệ trong file Excel mới',
      );
    }

    const oldFilePath = catalog.filePath;

    // Matching kho S1
    const s1Map = await this.batchMatchInventory(parsed.sheets);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Xóa sheets và items cũ của catalog này (cascade)
      await queryRunner.manager.delete(SaleExcelSheet, { catalogId });

      catalog.originalFileName = file.originalname;
      catalog.filePath = null;
      catalog.fileSize = file.size;
      catalog.templateType = tType;
      catalog.totalSheets = parsed.totalSheets;
      catalog.totalItems = parsed.totalItems;
      catalog.updatedByUserId = user?.id;

      await queryRunner.manager.save(catalog);

      for (const s of parsed.sheets) {
        const sheet = queryRunner.manager.create(SaleExcelSheet, {
          catalogId: catalog.id,
          sheetName: s.sheetName,
          sheetIndex: s.sheetIndex,
          itemCount: s.items.length,
        });
        const savedSheet = await queryRunner.manager.save(sheet);

        const itemEntities = s.items.map((i) => {
          const s1 = s1Map.get(i.productCode.toUpperCase());
          return queryRunner.manager.create(SaleExcelItem, {
            catalogId: catalog.id,
            sheetId: savedSheet.id,
            rowIndex: i.rowIndex,
            productCode: i.productCode,
            productName: i.productName,
            modelName: i.modelName || null,
            warranty: i.warranty || null,
            price: i.price,
            rawStatus: i.rawStatus || null,
            s1Matched: !!s1,
            s1ProductId: s1 ? s1.id : null,
            s1StockQuantity: s1 ? (s1.stock ?? 0) : null,
            isCustom: !s1,
          });
        });

        const chunkSize = 500;
        for (let idx = 0; idx < itemEntities.length; idx += chunkSize) {
          await queryRunner.manager.save(
            itemEntities.slice(idx, idx + chunkSize),
          );
        }
      }

      await queryRunner.commitTransaction();

      // Xóa file cũ
      if (oldFilePath && fs.existsSync(oldFilePath)) {
        try {
          await fs.promises.unlink(oldFilePath);
        } catch (_) {}
      }

      return {
        id: catalog.id,
        name: catalog.name,
        totalSheets: catalog.totalSheets,
        totalItems: catalog.totalItems,
      };
    } catch (err) {
      await queryRunner.rollbackTransaction();
      this.logger.error('Lỗi khi re-upload catalog', err);
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  // =========================================================================
  // ĐỔI TÊN DANH MỤC BẬC 1
  // =========================================================================
  async renameCatalog(
    catalogId: number,
    newName: string,
    user?: { id: number; roles?: { name: string }[] },
  ) {
    const catalog = await this.catalogRepo.findOne({
      where: { id: catalogId },
    });
    if (!catalog) {
      throw new NotFoundException('Không tìm thấy danh mục bảng giá');
    }

    const hasPerm = await this.checkUserPermission(
      user?.id || 0,
      'update',
      user?.roles,
    );
    if (!hasPerm) {
      throw new ForbiddenException('Bạn không có quyền sửa tên danh mục này');
    }

    if (!newName || !newName.trim()) {
      throw new BadRequestException('Tên danh mục không được để trống');
    }

    catalog.name = newName.trim();
    catalog.updatedByUserId = user?.id;
    await this.catalogRepo.save(catalog);
    return { id: catalog.id, name: catalog.name };
  }

  // =========================================================================
  // XÓA CATALOG
  // =========================================================================
  async deleteCatalog(
    catalogId: number,
    user?: { id: number; roles?: { name: string }[] },
  ) {
    const catalog = await this.catalogRepo.findOne({
      where: { id: catalogId },
    });
    if (!catalog) {
      throw new NotFoundException('Không tìm thấy danh mục bảng giá');
    }

    const hasPerm = await this.checkUserPermission(
      user?.id || 0,
      'delete',
      user?.roles,
    );
    if (!hasPerm) {
      throw new ForbiddenException('Bạn không có quyền xóa danh mục này');
    }

    const filePath = catalog.filePath;
    await this.catalogRepo.remove(catalog);

    if (filePath && fs.existsSync(filePath)) {
      try {
        await fs.promises.unlink(filePath);
      } catch (_) {}
    }

    return { success: true };
  }

  // =========================================================================
  // RENDER LẠI FILE EXCEL ĐỘNG TỪ DATABASE KHI TẢI
  // =========================================================================
  async renderCatalogWorkbook(
    catalogId: number,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const catalog = await this.catalogRepo.findOne({
      where: { id: catalogId },
      relations: ['sheets', 'sheets.items'],
      order: {
        sheets: {
          sheetIndex: 'ASC',
          items: {
            rowIndex: 'ASC',
          },
        },
      },
    });
    if (!catalog) {
      throw new NotFoundException('Không tìm thấy danh mục bảng giá');
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'SaleTracker System';
    workbook.lastModifiedBy = 'SaleTracker System';
    workbook.created = catalog.createdAt || new Date();
    workbook.modified = new Date();

    const sheets = catalog.sheets || [];
    if (sheets.length === 0) {
      const ws = workbook.addWorksheet('Sheet1');
      ws.addRow([
        'STT',
        'MÃ SẢN PHẨM',
        'TÊN SẢN PHẨM - CẤU HÌNH',
        'MODEL',
        'BẢO HÀNH',
        'ĐƠN GIÁ (VNĐ)',
        'TÌNH TRẠNG / GHI CHÚ',
        'KHO S1',
      ]);
    } else {
      for (const s of sheets) {
        const ws = workbook.addWorksheet(
          s.sheetName || `Sheet ${s.sheetIndex + 1}`,
        );

        // Header columns setup
        ws.columns = [
          { header: 'STT', key: 'stt', width: 8 },
          { header: 'MÃ SẢN PHẨM', key: 'productCode', width: 26 },
          { header: 'TÊN SẢN PHẨM - CẤU HÌNH', key: 'productName', width: 60 },
          { header: 'MODEL', key: 'modelName', width: 20 },
          { header: 'BẢO HÀNH', key: 'warranty', width: 15 },
          { header: 'ĐƠN GIÁ (VNĐ)', key: 'price', width: 18 },
          { header: 'TÌNH TRẠNG / GHI CHÚ', key: 'rawStatus', width: 30 },
          { header: 'KHO S1', key: 's1Stock', width: 18 },
        ];

        // Format header row
        const headerRow = ws.getRow(1);
        headerRow.font = { bold: true, color: { argb: 'FF1E293B' }, size: 10 };
        headerRow.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF1F5F9' },
        };
        headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
        headerRow.height = 26;

        headerRow.eachCell((cell) => {
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          };
        });

        // Add items rows
        const items = s.items || [];
        items.forEach((item, idx) => {
          const row = ws.addRow({
            stt: idx + 1,
            productCode: item.productCode || '',
            productName: item.productName || '',
            modelName: item.modelName || '',
            warranty: item.warranty || '',
            price: Number(item.price || 0),
            rawStatus: item.rawStatus || '',
            s1Stock: item.s1Matched
              ? `Còn hàng (${item.s1StockQuantity ?? 0})`
              : 'Mã tự tạo',
          });

          row.getCell('stt').alignment = {
            horizontal: 'center',
            vertical: 'middle',
          };
          row.getCell('productCode').alignment = {
            horizontal: 'left',
            vertical: 'middle',
          };
          row.getCell('productName').alignment = {
            horizontal: 'left',
            vertical: 'middle',
          };
          row.getCell('modelName').alignment = {
            horizontal: 'left',
            vertical: 'middle',
          };
          row.getCell('warranty').alignment = {
            horizontal: 'center',
            vertical: 'middle',
          };

          const priceCell = row.getCell('price');
          priceCell.numFmt = '#,##0';
          priceCell.alignment = { horizontal: 'right', vertical: 'middle' };

          row.getCell('rawStatus').alignment = {
            horizontal: 'left',
            vertical: 'middle',
          };
          row.getCell('s1Stock').alignment = {
            horizontal: 'center',
            vertical: 'middle',
          };

          row.eachCell((cell) => {
            cell.border = {
              top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
              left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
              bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
              right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
            };
          });
        });
      }
    }

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    let fileName = catalog.originalFileName || `${catalog.name}.xlsx`;
    if (!fileName.toLowerCase().endsWith('.xlsx')) {
      fileName += '.xlsx';
    }

    return { buffer, fileName };
  }

  // =========================================================================
  // TẢI FILE MẪU EXCEL (CHO TỪNG MẪU 1..4)
  // =========================================================================
  getTemplateDownload(templateType: number) {
    const map: Record<number, { fileName: string; fallbacks: string[] }> = {
      1: {
        fileName: 'Mau_1_BAO_GIA_NUC_LCD_ASUS.xlsx',
        fallbacks: [
          'P:/07.11.2026 BÁO GIÁ NUC-LCD ASUS (1).xlsx',
          'P:\\07.11.2026 BÁO GIÁ NUC-LCD ASUS (1).xlsx',
          path.join(process.cwd(), '..', '07.11.2026 BÁO GIÁ NUC-LCD ASUS (1).xlsx'),
          path.join(process.cwd(), '07.11.2026 BÁO GIÁ NUC-LCD ASUS (1).xlsx'),
        ],
      },
      2: {
        fileName: 'Mau_2_BBG_Quy_Dinh_Asus.xlsx',
        fallbacks: [
          'P:/BBG Quy Định Asus T10.2026 (1).xlsx',
          'P:\\BBG Quy Định Asus T10.2026 (1).xlsx',
          path.join(process.cwd(), '..', 'BBG Quy Định Asus T10.2026 (1).xlsx'),
          path.join(process.cwd(), 'BBG Quy Định Asus T10.2026 (1).xlsx'),
        ],
      },
      3: {
        fileName: 'Mau_3_BG_noi_bo_PC_MSI.xlsx',
        fallbacks: [
          'P:/BG nội bộ - PC MSI - T10.2026 (1).xlsx',
          'P:\\BG nội bộ - PC MSI - T10.2026 (1).xlsx',
          path.join(process.cwd(), '..', 'BG nội bộ - PC MSI - T10.2026 (1).xlsx'),
          path.join(process.cwd(), 'BG nội bộ - PC MSI - T10.2026 (1).xlsx'),
        ],
      },
      4: {
        fileName: 'Mau_4_BG_Silicon_Nikatei_FujiE.xlsx',
        fallbacks: [
          'P:/BG Silicon-Nikatei-FujiE Máy hủy, máy đếm tiền, máy hút-lọc không khí, tháng 09.2025 (1).xlsx',
          'P:\\BG Silicon-Nikatei-FujiE Máy hủy, máy đếm tiền, máy hút-lọc không khí, tháng 09.2025 (1).xlsx',
          path.join(process.cwd(), '..', 'BG Silicon-Nikatei-FujiE Máy hủy, máy đếm tiền, máy hút-lọc không khí, tháng 09.2025 (1).xlsx'),
          path.join(process.cwd(), 'BG Silicon-Nikatei-FujiE Máy hủy, máy đếm tiền, máy hút-lọc không khí, tháng 09.2025 (1).xlsx'),
        ],
      },
    };

    const target = map[templateType];
    if (!target) {
      throw new NotFoundException('Mẫu Excel không tồn tại');
    }

    for (const p of target.fallbacks) {
      if (fs.existsSync(p)) {
        return { filePath: p, fileName: target.fileName };
      }
    }

    throw new NotFoundException('Không tìm thấy file mẫu trên máy chủ');
  }

  // =========================================================================
  // LẤY CÂY DANH MỤC 2 CẤP
  // =========================================================================
  async getTree() {
    const catalogs = await this.catalogRepo.find({
      order: { updatedAt: 'DESC' },
      relations: ['sheets'],
    });

    return catalogs.map((c) => ({
      id: c.id,
      name: c.name,
      originalFileName: c.originalFileName,
      templateType: c.templateType,
      totalSheets: c.totalSheets,
      totalItems: c.totalItems,
      fileSize: c.fileSize,
      updatedAt: c.updatedAt,
      sheets: (c.sheets || [])
        .sort((a, b) => a.sheetIndex - b.sheetIndex)
        .map((s) => ({
          id: s.id,
          sheetName: s.sheetName,
          sheetIndex: s.sheetIndex,
          itemCount: s.itemCount,
        })),
    }));
  }

  // =========================================================================
  // LẤY DANH SÁCH ITEMS TRONG SHEET
  // =========================================================================
  async getSheetItems(
    sheetId: number,
    params: {
      page?: number;
      limit?: number;
      keyword?: string;
      filterS1?: 'all' | 's1_only' | 'custom_only';
    },
  ) {
    const page = Math.max(1, Number(params.page || 1));
    const limit = Math.min(200, Math.max(10, Number(params.limit || 50)));
    const skip = (page - 1) * limit;

    const qb = this.itemRepo
      .createQueryBuilder('item')
      .where('item.sheet_id = :sheetId', { sheetId });

    if (params.keyword && params.keyword.trim()) {
      const kw = `%${params.keyword.trim()}%`;
      qb.andWhere(
        '(item.product_code LIKE :kw OR item.product_name LIKE :kw OR item.model_name LIKE :kw)',
        { kw },
      );
    }

    if (params.filterS1 === 's1_only') {
      qb.andWhere('item.s1_matched = true');
    } else if (params.filterS1 === 'custom_only') {
      qb.andWhere('item.is_custom = true');
    }

    qb.orderBy('item.row_index', 'ASC');

    const [items, total] = await qb.skip(skip).take(limit).getManyAndCount();

    return {
      items: items.map((i) => ({
        id: i.id,
        catalogId: i.catalogId,
        sheetId: i.sheetId,
        rowIndex: i.rowIndex,
        productCode: i.productCode,
        productName: i.productName,
        modelName: i.modelName,
        warranty: i.warranty,
        price: i.price,
        rawStatus: i.rawStatus,
        s1Matched: i.s1Matched,
        s1ProductId: i.s1ProductId,
        s1StockQuantity: i.s1StockQuantity,
        isCustom: i.isCustom,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // =========================================================================
  // SO KHỚP TỒN KHO S1 (INTERNAL BATCH HELPER)
  // =========================================================================
  private async batchMatchInventory(sheets: { items: ParsedItemRow[] }[]) {
    const rawCodes = new Set<string>();
    sheets.forEach((s) => {
      s.items.forEach((i) => {
        if (i.productCode) rawCodes.add(i.productCode.trim().toUpperCase());
      });
    });

    const codeList = Array.from(rawCodes);
    const s1Map = new Map<string, { id: number; stock: number | null }>();

    if (codeList.length === 0) return s1Map;

    // Query theo chunk 1000 mã
    const chunkSize = 1000;
    for (let i = 0; i < codeList.length; i += chunkSize) {
      const chunk = codeList.slice(i, i + chunkSize);
      const products = await this.productRepo.find({
        where: { productCode: In(chunk), isActive: true },
        select: ['id', 'productCode', 'stock', 'isInStock'],
      });
      products.forEach((p) => {
        s1Map.set(p.productCode.toUpperCase(), {
          id: p.id,
          stock: p.stock ?? 0,
        });
      });
    }

    return s1Map;
  }
}
