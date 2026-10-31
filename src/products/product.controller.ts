import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Put,
  Delete,
  Query,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Response } from 'express';
import { ProductService } from './product.service';
import { WarrantyImportService } from './warranty-import.service';
import { WarrantyImporterGuard } from './warranty-importer.guard';
import { Product } from './product.entity';
import { AuthGuard } from '../common/guards/auth.guard';
import { AdminAuthGuard } from '../common/guards/admin-auth.guard';
import { Request } from 'express';

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@Controller('products')
export class ProductController {
  constructor(
    private readonly productService: ProductService,
    private readonly warrantyImportService: WarrantyImportService,
  ) {}

  @UseGuards(AuthGuard)
  @Get()
  findAll(
    @Query('search') search?: string,
    @Query('brands') brandsCsv?: string, // comma-separated brand names
    @Query('brand') brand?: string, // LIKE %...%
    @Query('categoryIds') categoryIdsCsv?: string, // comma-separated category IDs
    @Query('categoryId') categoryId?: string, // single category ID
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('pmCustomMode') pmCustomMode?: string, // Thêm parameter cho chế độ PM
    @Query('pmPermissions') pmPermissions?: string, // Thêm parameter cho PM permissions
    @Query('rolePermissions') rolePermissions?: string, // Thêm parameter cho thông tin từng role
    @Query('priceChanged') priceChanged?: string, // 'true' = chỉ sản phẩm từng đổi giá
    @Query('hasWarranty') hasWarranty?: string, // 'true'/'false' = có/chưa có bảo hành
    @Query('inStock') inStock?: string, // 'true' = còn hàng
    @Query('hasPrice') hasPrice?: string, // 'true'/'false' = có/không có giá
    @Query('minPrice') minPrice?: string, // giá từ
    @Query('maxPrice') maxPrice?: string, // giá đến
    @Query('sort') sort?: string, // price_asc|price_desc|stock_desc|updated_desc|name_asc|name_desc
    @Req() req?: Request,
  ) {
    const brands = brandsCsv
      ? brandsCsv
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      : undefined;
    const categoryIds = categoryIdsCsv
      ? categoryIdsCsv
          .split(',')
          .map((s) => Number(s.trim()))
          .filter((n) => !isNaN(n))
      : undefined;
    const pageNum = page ? Number(page) : undefined;
    const pageSizeNum = pageSize ? Number(pageSize) : undefined;
    const categoryIdNum = categoryId ? Number(categoryId) : undefined;
    const minPriceNum =
      minPrice !== undefined && minPrice !== '' && !isNaN(Number(minPrice))
        ? Number(minPrice)
        : undefined;
    const maxPriceNum =
      maxPrice !== undefined && maxPrice !== '' && !isNaN(Number(maxPrice))
        ? Number(maxPrice)
        : undefined;

    return this.productService.findAll({
      search,
      brands,
      brand,
      categoryIds,
      categoryId: Number.isFinite(categoryIdNum) ? categoryIdNum : undefined,
      page: pageNum,
      pageSize: pageSizeNum,
      user: (req as any)?.user,
      pmCustomMode,
      pmPermissions,
      rolePermissions,
      priceChanged: priceChanged === 'true',
      hasWarranty:
        hasWarranty === 'true'
          ? true
          : hasWarranty === 'false'
            ? false
            : undefined,
      inStock: inStock === 'true' ? true : undefined,
      hasPrice:
        hasPrice === 'true' ? true : hasPrice === 'false' ? false : undefined,
      minPrice: minPriceNum,
      maxPrice: maxPriceNum,
      sort,
    });
  }

  /** Lịch sử biến động giá (giá cũ → giá mới) — cho màn "giá đã biến động". */
  @UseGuards(AuthGuard)
  @Get('price-changes')
  findPriceChanges(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('productCode') productCode?: string,
    @Query('source') source?: string,
  ) {
    return this.productService.findPriceChanges({
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      from,
      to,
      productCode,
      source,
    });
  }

  /** Tải file mẫu nhập thời gian bảo hành (2 cột "MÃ HT", "TGBH"). */
  @UseGuards(AuthGuard)
  @Get('warranty-template')
  async warrantyTemplate(@Res() res: Response) {
    const buffer = await this.warrantyImportService.buildTemplate();
    res.set({
      'Content-Type': XLSX_MIME,
      'Content-Disposition':
        'attachment; filename="mau-nhap-bao-hanh-san-pham.xlsx"',
      'Content-Length': String(buffer.length),
    });
    res.send(buffer);
  }

  /** Danh sách user được admin chỉ định nạp file bảo hành (chỉ admin xem). */
  @UseGuards(AuthGuard, AdminAuthGuard)
  @Get('warranty-importers')
  listWarrantyImporters() {
    return this.warrantyImportService.listImporters();
  }

  @Get(':id')
  findOne(@Param('id') id: number) {
    return this.productService.findOne(id);
  }

  /**
   * Nạp thời gian bảo hành (tháng) từ file Excel 2 cột "MÃ HT" + "TGBH".
   * Dòng không có mã bị bỏ qua; mã không tìm thấy / TGBH sai được trả về
   * trong warnings để người nạp sửa file.
   *
   * Quyền: role admin, hoặc user được admin chỉ định riêng qua
   * POST /products/warranty-importers.
   */
  @UseGuards(AuthGuard, WarrantyImporterGuard)
  @Post('import-warranty')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async importWarranty(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Thiếu file Excel thời gian bảo hành');
    }
    const isXlsx =
      file.mimetype === XLSX_MIME ||
      String(file.originalname || '')
        .toLowerCase()
        .endsWith('.xlsx');
    if (!isXlsx) {
      throw new BadRequestException(
        'Chỉ hỗ trợ file .xlsx — hãy lưu file dưới dạng Excel Workbook (.xlsx)',
      );
    }
    return this.warrantyImportService.importFromExcel(file);
  }

  // --------------------------------------- admin quản lý người được chỉ định

  /** Admin chỉ định thêm 1 user (idempotent — thêm trùng không lỗi). */
  @UseGuards(AuthGuard, AdminAuthGuard)
  @Post('warranty-importers')
  @HttpCode(HttpStatus.OK)
  addWarrantyImporter(
    @Body() body: { userId?: number; userIds?: number[] },
    @Req() req?: Request,
  ) {
    const authedReq = req as unknown as { user?: { id?: number } };
    const createdBy = Number(authedReq?.user?.id) || null;
    const userIds = Array.isArray(body?.userIds)
      ? body.userIds
      : body?.userId
        ? [body.userId]
        : [];
    if (userIds.length === 0) {
      throw new BadRequestException('Thiếu userId (hoặc userIds[])');
    }
    // Chạy tuần tự để log thứ tự chỉ định rõ ràng; số lượng nhỏ nên ổn.
    return Promise.all(
      userIds.map((userId) =>
        this.warrantyImportService.addImporter(Number(userId), createdBy),
      ),
    );
  }

  /** Admin gỡ chỉ định của 1 user. */
  @UseGuards(AuthGuard, AdminAuthGuard)
  @Delete('warranty-importers/:userId')
  removeWarrantyImporter(@Param('userId') userId: number) {
    return this.warrantyImportService.removeImporter(Number(userId));
  }

  @Post()
  create(@Body() data: Partial<Product>) {
    return this.productService.create(data);
  }

  @Put(':id')
  update(@Param('id') id: number, @Body() data: Partial<Product>) {
    return this.productService.update(id, data);
  }

  @Delete(':id')
  remove(@Param('id') id: number) {
    return this.productService.remove(id);
  }
}
