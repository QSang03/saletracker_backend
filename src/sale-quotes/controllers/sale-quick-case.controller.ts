import { AuthenticatedRequest } from '../types/auth-user.type';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthGuard } from '../../common/guards/auth.guard';
import { SaleQuickCaseService } from '../services/sale-quick-case.service';
import { SaleExcelService } from '../services/sale-excel.service';
import { SaleSettingsService } from '../services/sale-settings.service';
import { getUserId } from '../utils/entity-access.util';
import {
  BulkQuickCaseDto,
  CreateQuickCaseDto,
  QueryQuickCaseDto,
  QuickCaseItemInputDto,
  UpdateQuickCaseDto,
  UpdateQuickCaseItemDto,
} from '../dto/quick-case.dto';
import { ReorderItemsDto } from '../dto/common.dto';

@Controller('sale-quotes/quick-cases')
@UseGuards(AuthGuard)
export class SaleQuickCaseController {
  constructor(
    private readonly quickCaseService: SaleQuickCaseService,
    private readonly excelService: SaleExcelService,
    private readonly settingsService: SaleSettingsService,
  ) {}

  @Post()
  create(@Body() dto: CreateQuickCaseDto, @Req() req: AuthenticatedRequest) {
    return this.quickCaseService.create(dto, req.user);
  }

  @Post('bulk')
  createBulk(@Body() dto: BulkQuickCaseDto, @Req() req: AuthenticatedRequest) {
    return this.quickCaseService.createBulk(dto, req.user);
  }

  @Get()
  findAll(@Query() query: QueryQuickCaseDto, @Req() req: AuthenticatedRequest) {
    return this.quickCaseService.findAll(query, req.user);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.quickCaseService.findOne(id, req.user);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateQuickCaseDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.quickCaseService.update(id, dto, req.user);
  }

  @Delete(':id')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.quickCaseService.remove(id, req.user);
  }

  @Post(':id/recalculate-prices')
  recalculatePrices(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.quickCaseService.recalculatePrices(id, req.user);
  }

  @Post(':id/duplicate')
  duplicate(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.quickCaseService.duplicate(id, req.user);
  }

  @Post(':id/items')
  addItem(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: QuickCaseItemInputDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.quickCaseService.addItem(id, dto, req.user);
  }

  @Patch(':id/items/:itemId')
  updateItem(
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body() dto: UpdateQuickCaseItemDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.quickCaseService.updateItem(
      id,
      itemId,
      dto,
      req.user,
    );
  }

  @Delete(':id/items/:itemId')
  removeItem(
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.quickCaseService.removeItem(
      id,
      itemId,
      req.user,
    );
  }

  @Post(':id/items/reorder')
  reorderItems(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReorderItemsDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.quickCaseService.reorderItems(
      id,
      dto.itemIds,
      req.user,
    );
  }

  @Get(':id/text')
  renderText(
    @Param('id', ParseIntPipe) id: number,
    @Query('zaloSuffix') zaloSuffix: string | undefined,
    @Query('globalNote') globalNote: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.quickCaseService.renderText(
      id,
      req.user,
      zaloSuffix,
      globalNote,
    );
  }

  @Get(':id/export')
  async exportExcel(
    @Param('id', ParseIntPipe) id: number,
    @Query('type') type: 'internal' | 'customer' = 'internal',
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ) {
    const quickCase = await this.quickCaseService.findOne(
      id,
      req.user,
    );
    const userId = getUserId(req.user);
    const settings = await this.settingsService.getForUser(userId);
    const buffer = await this.excelService.buildQuickCaseWorkbook(
      quickCase,
      type === 'customer' ? 'customer' : 'internal',
      settings,
    );
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yy = String(now.getFullYear()).slice(-2);
    const dateStr = `${dd}.${mm}.${yy}`;
    const cleanTitle = (quickCase.title || '').trim().replace(/[\/\\:*?"<>|]/g, '_');
    const filename = cleanTitle
      ? `BÁO GIÁ THEO YÊU CẦU_${cleanTitle}_${dateStr}`
      : `BÁO GIÁ THEO YÊU CẦU_${dateStr}`;
    this.sendXlsx(res, buffer, filename);
  }

  private sendXlsx(res: Response, buffer: Buffer, filename: string) {
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    const encoded = encodeURIComponent(filename);
    const asciiFallback = filename.replace(/[^a-zA-Z0-9-_]/g, '-');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiFallback}.xlsx"; filename*=UTF-8''${encoded}.xlsx`,
    );
    res.send(buffer);
  }
}
