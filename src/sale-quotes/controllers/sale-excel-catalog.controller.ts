import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  Req,
  Res,
  UseInterceptors,
  UploadedFile,
  ParseIntPipe,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '../../common/guards/auth.guard';
import {
  AuthenticatedRequest,
  AuthenticatedUser,
} from '../types/auth-user.type';
import {
  SaleExcelCatalogService,
  UserPermissionDto,
} from '../services/sale-excel-catalog.service';

function normalizeRoles(user: AuthenticatedUser): { name: string }[] {
  if (!user?.roles || !Array.isArray(user.roles)) return [];
  return user.roles.map((r: any) =>
    typeof r === 'string' ? { name: r } : { name: r.name },
  );
}

function checkAdmin(user: AuthenticatedUser): boolean {
  const roles = normalizeRoles(user);
  return roles.some((r) => r.name === 'admin' || r.name === 'Super Admin');
}

@Controller('sale-excel')
export class SaleExcelCatalogController {
  constructor(private readonly excelService: SaleExcelCatalogService) {}

  // =========================================================================
  // CÂY DANH MỤC 2 CẤP
  // =========================================================================
  @Get('tree')
  @UseGuards(AuthGuard)
  async getTree() {
    const data = await this.excelService.getTree();
    return { success: true, data };
  }

  // =========================================================================
  // DANH SÁCH ITEMS TRONG SHEET
  // =========================================================================
  @Get('sheets/:sheetId/items')
  @UseGuards(AuthGuard)
  async getSheetItems(
    @Param('sheetId', ParseIntPipe) sheetId: number,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('keyword') keyword?: string,
    @Query('filterS1') filterS1?: 'all' | 's1_only' | 'custom_only',
  ) {
    const data = await this.excelService.getSheetItems(sheetId, {
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 50,
      keyword,
      filterS1,
    });
    return { success: true, data };
  }

  // =========================================================================
  // TẢI FILE EXCEL (RENDER ĐỘNG TỪ DATABASE)
  // =========================================================================
  @Get(':id/download')
  @UseGuards(AuthGuard)
  async downloadCatalog(
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    const { buffer, fileName } =
      await this.excelService.renderCatalogWorkbook(id);
    const safeFileName = encodeURIComponent(fileName);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${safeFileName}"; filename*=UTF-8''${safeFileName}`,
    );
    return res.send(buffer);
  }

  // =========================================================================
  // QUẢN LÝ MẪU EXCEL ĐỘNG (DYNAMIC TEMPLATES)
  // =========================================================================
  @Post('templates/inspect')
  @UseGuards(AuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 30 * 1024 * 1024 },
    }),
  )
  async inspectTemplateFile(@UploadedFile() file: Express.Multer.File) {
    const data = await this.excelService.inspectTemplateFile(file);
    return { success: true, data };
  }

  @Post('templates')
  @UseGuards(AuthGuard)
  async createTemplate(
    @Body() dto: any,
    @Req() req: AuthenticatedRequest,
  ) {
    const data = await this.excelService.createTemplate(dto, req.user?.id);
    return { success: true, data };
  }

  @Get('templates')
  @UseGuards(AuthGuard)
  async getAllTemplates() {
    const data = await this.excelService.getAllTemplates();
    return { success: true, data };
  }

  @Get('templates/:id')
  @UseGuards(AuthGuard)
  async getTemplateById(@Param('id', ParseIntPipe) id: number) {
    const data = await this.excelService.getTemplateById(id);
    return { success: true, data };
  }

  @Put('templates/:id')
  @UseGuards(AuthGuard)
  async updateTemplate(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: any,
  ) {
    const data = await this.excelService.updateTemplate(id, dto);
    return { success: true, data };
  }

  @Delete('templates/:id')
  @UseGuards(AuthGuard)
  async deleteTemplate(@Param('id', ParseIntPipe) id: number) {
    const data = await this.excelService.deleteTemplate(id);
    return { success: true, data };
  }

  @Get('templates/:id/download-sample')
  async downloadDynamicTemplateSample(
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    const { buffer, fileName } =
      await this.excelService.renderDynamicTemplateSample(id);
    const safeFileName = encodeURIComponent(fileName);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${safeFileName}"; filename*=UTF-8''${safeFileName}`,
    );
    return res.send(buffer);
  }

  // =========================================================================
  // TẢI FILE MẪU EXCEL (CHO TỪNG MẪU 1..4 - PUBLIC TẢI FILE MẪU)
  // =========================================================================
  @Get('template-download/:templateType')
  async downloadTemplate(
    @Param('templateType', ParseIntPipe) templateType: number,
    @Res() res: Response,
  ) {
    const { buffer, fileName } =
      await this.excelService.generateSampleTemplate(templateType);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(fileName)}"`,
    );
    return res.send(buffer);
  }

  // =========================================================================
  // UPLOAD CATALOG MỚI
  // =========================================================================
  @Post('upload')
  @UseGuards(AuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 30 * 1024 * 1024 }, // 30MB
    }),
  )
  async uploadCatalog(
    @UploadedFile() file: Express.Multer.File,
    @Body('templateType') templateTypeRaw: string,
    @Body('name') customName: string,
    @Req() req: AuthenticatedRequest,
  ) {
    if (!file) {
      throw new BadRequestException('Vui lòng chọn file Excel');
    }
    const templateType = parseInt(templateTypeRaw, 10) || 1;
    const roles = normalizeRoles(req.user);

    const data = await this.excelService.uploadCatalog(
      file,
      templateType,
      customName,
      { id: req.user.id, roles },
    );
    return { success: true, data };
  }

  // =========================================================================
  // RE-UPLOAD (NẠP ĐÈ FILE MỚI)
  // =========================================================================
  @Put(':id/re-upload')
  @UseGuards(AuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 30 * 1024 * 1024 },
    }),
  )
  async reuploadCatalog(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
    @Body('templateType') templateTypeRaw: string,
    @Req() req: AuthenticatedRequest,
  ) {
    if (!file) {
      throw new BadRequestException('Vui lòng chọn file Excel');
    }
    const templateType = templateTypeRaw
      ? parseInt(templateTypeRaw, 10)
      : undefined;
    const roles = normalizeRoles(req.user);

    const data = await this.excelService.reuploadCatalog(
      id,
      file,
      templateType,
      { id: req.user.id, roles },
    );
    return { success: true, data };
  }

  // =========================================================================
  // ĐỔI TÊN DANH MỤC BẬC 1
  // =========================================================================
  @Patch(':id/rename')
  @UseGuards(AuthGuard)
  async renameCatalog(
    @Param('id', ParseIntPipe) id: number,
    @Body('name') newName: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const roles = normalizeRoles(req.user);
    const data = await this.excelService.renameCatalog(id, newName, {
      id: req.user.id,
      roles,
    });
    return { success: true, data };
  }

  // =========================================================================
  // XÓA CATALOG
  // =========================================================================
  @Delete(':id')
  @UseGuards(AuthGuard)
  async deleteCatalog(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthenticatedRequest,
  ) {
    const roles = normalizeRoles(req.user);
    const data = await this.excelService.deleteCatalog(id, {
      id: req.user.id,
      roles,
    });
    return { success: true, data };
  }

  // =========================================================================
  // PHÂN QUYỀN
  // =========================================================================
  @Get('my-permissions')
  @UseGuards(AuthGuard)
  async getMyPermissions(@Req() req: AuthenticatedRequest) {
    const roles = normalizeRoles(req.user);
    const data = await this.excelService.getMyPermissions(req.user.id, roles);
    return { success: true, data };
  }

  @Get('permissions')
  @UseGuards(AuthGuard)
  async getAllPermissions(@Req() req: AuthenticatedRequest) {
    if (!checkAdmin(req.user)) {
      throw new ForbiddenException(
        'Chỉ Admin mới có quyền xem danh sách phân quyền',
      );
    }
    const data = await this.excelService.getAllPermissions();
    return { success: true, data };
  }

  @Post('permissions')
  @UseGuards(AuthGuard)
  async savePermissions(
    @Body('permissions') permissions: UserPermissionDto[],
    @Req() req: AuthenticatedRequest,
  ) {
    if (!checkAdmin(req.user)) {
      throw new ForbiddenException(
        'Chỉ Admin mới có quyền chỉnh sửa phân quyền',
      );
    }
    if (!Array.isArray(permissions)) {
      throw new BadRequestException('Dữ liệu phân quyền không hợp lệ');
    }
    const data = await this.excelService.savePermissions(
      permissions,
      req.user.id,
    );
    return { success: true, data };
  }
}
