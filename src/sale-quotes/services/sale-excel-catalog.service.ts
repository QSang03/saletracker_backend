import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  InternalServerErrorException,
  HttpException,
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
import {
  SaleExcelTemplate,
  SheetGroupMapping,
} from '../entities/sale-excel-template.entity';
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
    @InjectRepository(SaleExcelTemplate)
    private readonly templateRepo: Repository<SaleExcelTemplate>,
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
  // XEM TRƯỚC DỮ LIỆU NẠP FILE THEO MẪU (PREVIEW UPLOAD)
  // =========================================================================
  async previewUploadCatalog(
    file: Express.Multer.File,
    templateType: number,
  ) {
    if (!file) {
      throw new BadRequestException('Vui lòng chọn file Excel');
    }

    const tType = Number(templateType) || 1;
    const dynamicTemplate = await this.templateRepo.findOne({
      where: { id: tType },
    });

    let parsed: any;
    if (dynamicTemplate) {
      // 1. Kiểm tra cấu trúc cột
      const validation =
        await this.parserService.validateFileAgainstTemplate(
          file.buffer,
          dynamicTemplate,
        );
      if (!validation.isValid) {
        throw new BadRequestException({
          errorType: 'TEMPLATE_COLUMN_MISMATCH',
          message: 'Cấu trúc file không khớp với mẫu đã chọn',
          errors: validation.errors,
        });
      }

      parsed = await this.parserService.parseBufferWithTemplate(
        file.buffer,
        dynamicTemplate,
        { isPreview: true },
      );
    } else {
      parsed = await this.parserService.parseBuffer(file.buffer, tType);
    }

    // 2. So khớp nhanh tồn kho S1
    const s1Map = await this.batchMatchInventory(parsed.sheets, parsed.previewRows);
    let s1MatchCount = 0;

    const previewItems = (parsed.previewRows || []).map((item: any) => {
      const codeStr = String(item.productCode || '').trim();
      const s1 = codeStr ? s1Map.get(codeStr.toUpperCase()) : undefined;
      if (s1 && item.isValid) {
        s1MatchCount++;
      }
      return {
        ...item,
        s1Matched: !!s1,
        s1Stock: s1 ? (s1.stock ?? 0) : null,
      };
    });

    return {
      fileName: file.originalname,
      fileSize: file.size,
      totalRows: parsed.totalRows ?? parsed.totalItems,
      validCount: parsed.validCount ?? parsed.totalItems,
      invalidCount: parsed.invalidCount ?? 0,
      totalSheets: parsed.totalSheets,
      sheets: parsed.sheetSummaries ?? [],
      items: previewItems.slice(0, 5000), // Preview tối đa 5000 dòng để hiển thị trọn vẹn file
      errors: parsed.allRowErrors || [],
      s1MatchCount,
      allExcelColumns: parsed.allExcelColumns || [],
    };
  }

  // =========================================================================
  // UPLOAD CATALOG MỚI
  // =========================================================================
  async uploadCatalog(
    file: Express.Multer.File,
    templateType: number,
    customName?: string,
    user?: { id: number; roles?: { name: string }[] },
    allowSkipInvalid?: boolean,
  ) {
    if (!file) {
      throw new BadRequestException('Vui lòng chọn file Excel');
    }

    try {
      const hasPerm = await this.checkUserPermission(
        user?.id || 0,
        'upload',
        user?.roles,
      );
      if (!hasPerm) {
        throw new ForbiddenException('Bạn không có quyền tải lên file Excel');
      }

      const cleanName = (
        customName || file.originalname.replace(/\.[^/.]+$/, '')
      ).trim();

      // 1. Kiểm tra xem có template động tương ứng trong DB không
      const dynamicTemplate = await this.templateRepo.findOne({
        where: { id: Number(templateType) },
      });

      let parsed;
      if (dynamicTemplate) {
        // Xác thực cấu trúc file trước khi nạp: phát hiện Tab nào bị sai lệch cột
        const validation =
          await this.parserService.validateFileAgainstTemplate(
            file.buffer,
            dynamicTemplate,
          );
        if (!validation.isValid) {
          throw new BadRequestException({
            message: 'Cấu trúc file không khớp với mẫu đã chọn',
            errors: validation.errors,
          });
        }
        parsed = await this.parserService.parseBufferWithTemplate(
          file.buffer,
          dynamicTemplate,
          { allowSkipInvalid },
        );
      } else {
        // Fallback
        parsed = await this.parserService.parseBuffer(file.buffer, templateType);
      }

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
        const safeTemplateType =
          Number(templateType) >= 1 && Number(templateType) <= 127
            ? Number(templateType)
            : 1;

        const catalog = queryRunner.manager.create(SaleExcelCatalog, {
          name: cleanName,
          originalFileName: file.originalname,
          filePath: null,
          fileSize: file.size,
          templateType: safeTemplateType,
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
            excelColumns: s.excelColumns || null,
          });
          const savedSheet = await queryRunner.manager.save(sheet);

          const itemEntities = s.items.map((i) => {
            const codeStr = String(i.productCode || '').trim();
            const s1 = codeStr ? s1Map.get(codeStr.toUpperCase()) : undefined;
            return queryRunner.manager.create(SaleExcelItem, {
              catalogId: savedCatalog.id,
              sheetId: savedSheet.id,
              rowIndex: i.rowIndex,
              productCode: (codeStr || 'SP').slice(0, 250),
              productName: String(i.productName || 'Sản phẩm').slice(0, 10000),
              modelName: i.modelName ? String(i.modelName).slice(0, 250) : null,
              warranty: i.warranty ? String(i.warranty).slice(0, 95) : null,
              price: Number(i.price) || 0,
              rawStatus: i.rawStatus ? String(i.rawStatus).slice(0, 5000) : null,
              s1Matched: !!s1,
              s1ProductId: s1 ? s1.id : null,
              s1StockQuantity: s1 ? (s1.stock ?? 0) : null,
              isCustom: !s1,
              rawData: i.rawData || null,
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
    } catch (err: any) {
      this.logger.error('=== LỖI UPLOAD CATALOG ===', err?.stack || err);
      if (err instanceof HttpException) {
        throw err;
      }
      throw new InternalServerErrorException(
        `Lỗi xử lý file Excel: ${err?.message || 'Không thể lưu vào cơ sở dữ liệu'}`,
      );
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
    allowSkipInvalid?: boolean,
  ) {
    try {
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

      // 1. Kiểm tra template động
      const dynamicTemplate = await this.templateRepo.findOne({
        where: { id: tType },
      });

      let parsed;
      if (dynamicTemplate) {
        const validation =
          await this.parserService.validateFileAgainstTemplate(
            file.buffer,
            dynamicTemplate,
          );
        if (!validation.isValid) {
          throw new BadRequestException({
            message: 'Cấu trúc file không khớp với mẫu đã chọn',
            errors: validation.errors,
          });
        }
        parsed = await this.parserService.parseBufferWithTemplate(
          file.buffer,
          dynamicTemplate,
          { allowSkipInvalid },
        );
      } else {
        parsed = await this.parserService.parseBuffer(file.buffer, tType);
      }

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

        const safeTemplateType =
          Number(tType) >= 1 && Number(tType) <= 127 ? Number(tType) : 1;

        catalog.originalFileName = file.originalname;
        catalog.filePath = null;
        catalog.fileSize = file.size;
        catalog.templateType = safeTemplateType;
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
            excelColumns: s.excelColumns || null,
          });
          const savedSheet = await queryRunner.manager.save(sheet);

          const itemEntities = s.items.map((i) => {
            const codeStr = String(i.productCode || '').trim();
            const s1 = codeStr ? s1Map.get(codeStr.toUpperCase()) : undefined;
            return queryRunner.manager.create(SaleExcelItem, {
              catalogId: catalog.id,
              sheetId: savedSheet.id,
              rowIndex: i.rowIndex,
              productCode: (codeStr || 'SP').slice(0, 250),
              productName: String(i.productName || 'Sản phẩm').slice(0, 10000),
              modelName: i.modelName ? String(i.modelName).slice(0, 250) : null,
              warranty: i.warranty ? String(i.warranty).slice(0, 95) : null,
              price: Number(i.price) || 0,
              rawStatus: i.rawStatus ? String(i.rawStatus).slice(0, 5000) : null,
              s1Matched: !!s1,
              s1ProductId: s1 ? s1.id : null,
              s1StockQuantity: s1 ? (s1.stock ?? 0) : null,
              isCustom: !s1,
              rawData: i.rawData || null,
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
    } catch (err: any) {
      this.logger.error('=== LỖI REUPLOAD CATALOG ===', err?.stack || err);
      if (err instanceof HttpException) {
        throw err;
      }
      throw new InternalServerErrorException(
        `Lỗi xử lý file Excel nạp đè: ${err?.message || 'Không thể lưu vào cơ sở dữ liệu'}`,
      );
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
  // TẢI FILE MẪU EXCEL (CHO TỪNG MẪU 1..4 - CHỈ RENDER THUẦN CẤU TRÚC CỘT & TAB)
  // =========================================================================
  async generateSampleTemplate(
    templateType: number,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const fileNames: Record<number, string> = {
      1: 'Mau_1_BAO_GIA_NUC_LCD_ASUS.xlsx',
      2: 'Mau_2_BBG_Quy_Dinh_Asus.xlsx',
      3: 'Mau_3_BG_noi_bo_PC_MSI.xlsx',
      4: 'Mau_4_BG_Silicon_Nikatei_FujiE.xlsx',
    };

    const fileName = fileNames[templateType];
    if (!fileName) {
      throw new NotFoundException('Mẫu Excel không tồn tại');
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'SaleTracker System';
    workbook.created = new Date();

    if (templateType === 1) {
      // Mẫu 1: ASUS NUC & LCD (Header ở dòng 2)
      const ws1 = workbook.addWorksheet('NUC-MINi');
      ws1.addRow([]); // Dòng 1 trống
      const hRow1 = ws1.addRow([
        'NO',
        'PRODUCT CODE HT',
        'MODEL NAME',
        'PRODUCT CODE 1',
        'PRODUCT CODE',
        'WARRANTY',
        'UNIT PRICE',
        'PRODUCT STATUS',
        'FUND',
        'NPP',
      ]);
      this.formatTemplateHeader(hRow1);

      const ws2 = workbook.addWorksheet('LCD');
      ws2.addRow([]); // Dòng 1 trống
      const hRow2 = ws2.addRow([
        'NO',
        'PRODUCT CODE HT',
        'MODEL NAME',
        'PRODUCT CODE',
        'WARRANTY',
        'UNIT PRICE',
        'PRODUCT STATUS',
        'FUND',
      ]);
      this.formatTemplateHeader(hRow2);
    } else if (templateType === 2) {
      // Mẫu 2: Bảng Giá Quy Định ASUS Hãng (Header ở dòng 2 - dữ liệu từ dòng 4)
      const ws = workbook.addWorksheet('Sheet1');
      ws.addRow([]); // Dòng 1 trống
      const hRow = ws.addRow([
        'STT',
        'Model Name',
        'Chi Tiết',
        'TGBH',
        'Giá Bán Có Vat',
        'Thông tin Hàng',
        'Funding',
      ]);
      this.formatTemplateHeader(hRow);
      ws.addRow([]); // Dòng 3 để trống
    } else if (templateType === 3) {
      // Mẫu 3: Báo Giá Nội Bộ PC MSI (Header ở dòng 1)
      const ws = workbook.addWorksheet('BG');
      const hRow = ws.addRow([
        'STT',
        'Model Name',
        'Mã kho S1',
        'Loại máy',
        'Cấu hình',
        'Bảo hành',
        'Giá',
        'Noted',
        'Fund',
      ]);
      this.formatTemplateHeader(hRow);
    } else if (templateType === 4) {
      // Mẫu 4: Thiết Bị Văn Phòng & Gia Dụng
      const ws1 = workbook.addWorksheet('Gia Dealer');
      ws1.addRow([]); // Dòng 1 trống
      const hRow1 = ws1.addRow([
        'STT',
        'Mã kho NK / Model Mã',
        'Sản phẩm + Hãng + Models',
        'TGBH / Warranty',
        'GíaNK.Dealer FULL VAT / End User',
        'Giá Bán Lẻ',
        'Ghi chú',
      ]);
      this.formatTemplateHeader(hRow1);

      const ws2 = workbook.addWorksheet('shredder-SILICON');
      ws2.addRow([]); // Dòng 1 trống
      const hRow2 = ws2.addRow([
        'STT',
        'Model Mã',
        'Sản phẩm',
        'TGBH',
        'GíaNK.Dealer FULL VAT',
      ]);
      this.formatTemplateHeader(hRow2);

      const ws3 = workbook.addWorksheet('Cash-Silicon');
      ws3.addRow([]); // Dòng 1 trống
      const hRow3 = ws3.addRow([
        'STT',
        'Model Mã',
        'Sản phẩm',
        'TGBH',
        'GíaNK.Dealer FULL VAT',
      ]);
      this.formatTemplateHeader(hRow3);
    }

    // Tự động căn chỉnh độ rộng cột theo tiêu đề
    workbook.worksheets.forEach((sheet) => {
      sheet.columns.forEach((col: any) => {
        let maxLen = 14;
        col.eachCell?.({ includeEmpty: false }, (cell: any) => {
          const val = cell.value ? String(cell.value) : '';
          if (val.length > maxLen) maxLen = Math.min(val.length + 4, 45);
        });
        col.width = maxLen;
      });
    });

    const rawBuffer = await workbook.xlsx.writeBuffer();
    const buffer = Buffer.from(rawBuffer);
    return { buffer, fileName };
  }

  /**
   * Helper format dòng header của file mẫu (tô màu nền nhẹ, in đậm, border mỏng)
   */
  private formatTemplateHeader(row: ExcelJS.Row) {
    row.height = 28;
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { bold: true, color: { argb: 'FF0F172A' }, size: 10 };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF1F5F9' },
      };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      };
    });
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
    const sheet = await this.sheetRepo.findOne({
      where: { id: sheetId },
      select: ['id', 'excelColumns'],
    });

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
        rawData: i.rawData || null,
      })),
      excelColumns: sheet?.excelColumns || [],
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
  private async batchMatchInventory(
    sheets: { items: ParsedItemRow[] }[],
    previewRows?: any[],
  ) {
    const rawCodes = new Set<string>();
    (sheets || []).forEach((s) => {
      (s.items || []).forEach((i) => {
        if (i.productCode) rawCodes.add(i.productCode.trim().toUpperCase());
      });
    });
    (previewRows || []).forEach((r) => {
      if (r.productCode) rawCodes.add(String(r.productCode).trim().toUpperCase());
    });

    const codeList = Array.from(rawCodes).filter((c) => c.length > 0);
    const s1Map = new Map<string, { id: number; stock: number | null; price?: number | null }>();

    if (codeList.length === 0) return s1Map;

    // Query theo chunk 500 mã
    const chunkSize = 500;
    for (let i = 0; i < codeList.length; i += chunkSize) {
      const chunk = codeList.slice(i, i + chunkSize);
      const queryCodes = Array.from(
        new Set([
          ...chunk,
          ...chunk.map((c) => c.toLowerCase()),
        ]),
      );

      // KHÔNG lọc isActive: true vì nhiều mã sản phẩm trong kho S1 có thể có isActive = false/null nhưng vẫn có tồn kho
      const products = await this.productRepo.find({
        where: { productCode: In(queryCodes) },
        select: ['id', 'productCode', 'stock', 'price', 'isInStock'],
      });

      products.forEach((p) => {
        if (p.productCode) {
          s1Map.set(p.productCode.trim().toUpperCase(), {
            id: p.id,
            stock: p.stock ?? 0,
            price: p.price ?? 0,
          });
        }
      });
    }

    return s1Map;
  }

  // =========================================================================
  // QUẢN LÝ MẪU CẤU TRÚC ĐỘNG (DYNAMIC TEMPLATES)
  // =========================================================================
  async inspectTemplateFile(file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Vui lòng tải lên file Excel');
    }
    return this.parserService.inspectTemplateBuffer(file.buffer);
  }

  async createTemplate(
    dto: {
      name: string;
      description?: string;
      sheetGroups: SheetGroupMapping[];
    },
    userId?: number,
  ) {
    if (!dto.name || !dto.name.trim()) {
      throw new BadRequestException('Vui lòng nhập tên mẫu');
    }
    if (!dto.sheetGroups || dto.sheetGroups.length === 0) {
      throw new BadRequestException(
        'Vui lòng định nghĩa ít nhất 1 nhóm cấu trúc cột',
      );
    }

    const t = this.templateRepo.create({
      name: dto.name.trim(),
      description: dto.description?.trim() || null,
      sheetGroups: dto.sheetGroups,
      createdById: userId || null,
    });
    return this.templateRepo.save(t);
  }

  async getAllTemplates() {
    return this.templateRepo.find({
      order: { updatedAt: 'DESC' },
    });
  }

  async getTemplateById(id: number) {
    const t = await this.templateRepo.findOne({ where: { id } });
    if (!t) throw new NotFoundException('Không tìm thấy mẫu cấu trúc Excel');
    return t;
  }

  async updateTemplate(
    id: number,
    dto: {
      name?: string;
      description?: string;
      sheetGroups?: SheetGroupMapping[];
    },
  ) {
    const t = await this.getTemplateById(id);
    if (dto.name !== undefined) t.name = dto.name.trim();
    if (dto.description !== undefined)
      t.description = dto.description?.trim() || null;
    if (dto.sheetGroups !== undefined) t.sheetGroups = dto.sheetGroups;
    return this.templateRepo.save(t);
  }

  async deleteTemplate(id: number) {
    const t = await this.getTemplateById(id);
    await this.templateRepo.remove(t);
    return { success: true };
  }

  async renderDynamicTemplateSample(
    templateId: number,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const template = await this.getTemplateById(templateId);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'SaleTracker System';
    workbook.created = new Date();

    for (const group of template.sheetGroups) {
      const sheets =
        group.appliedSheets && group.appliedSheets.length > 0
          ? group.appliedSheets
          : ['Sheet1'];

      for (const sheetName of sheets) {
        const ws = workbook.addWorksheet(sheetName);

        const headerRowIdx = group.headerRow || 1;
        for (let r = 1; r < headerRowIdx; r++) {
          ws.addRow([]);
        }

        let colsToAdd =
          group.excelColumns && group.excelColumns.length > 0
            ? group.excelColumns
            : Object.values(group.columns).filter(Boolean);

        if (colsToAdd.length === 0) {
          colsToAdd = ['STT', 'Mã Sản Phẩm', 'Tên Sản Phẩm', 'Đơn Giá'];
        }

        const hRow = ws.addRow(colsToAdd);
        this.formatTemplateHeader(hRow);
      }
    }

    workbook.worksheets.forEach((sheet) => {
      sheet.columns.forEach((col: any) => {
        let maxLen = 14;
        col.eachCell?.({ includeEmpty: false }, (cell: any) => {
          const val = cell.value ? String(cell.value) : '';
          if (val.length > maxLen) maxLen = Math.min(val.length + 4, 45);
        });
        col.width = maxLen;
      });
    });

    const rawBuffer = await workbook.xlsx.writeBuffer();
    const buffer = Buffer.from(rawBuffer);
    const safeName = template.name.replace(
      /[^a-zA-Z0-9_\u00C0-\u024F\u1EA0-\u1EF9]/g,
      '_',
    );
    return { buffer, fileName: `${safeName}_Mau_Excel.xlsx` };
  }
}
