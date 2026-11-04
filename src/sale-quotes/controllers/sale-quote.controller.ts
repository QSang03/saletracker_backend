import { AuthenticatedRequest } from '../types/auth-user.type';
import { SaleQuote } from '../entities/sale-quote.entity';
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
import { SaleQuoteService } from '../services/sale-quote.service';
import { SaleExcelService } from '../services/sale-excel.service';
import { SaleSettingsService } from '../services/sale-settings.service';
import { getUserId } from '../utils/entity-access.util';
import {
  CreateQuoteDto,
  QueryQuoteDto,
  QuoteExportQueryDto,
  QuoteItemInputDto,
  QuoteTextQueryDto,
  UpdateQuoteDto,
  UpdateQuoteItemDto,
} from '../dto/quote.dto';
import { ReorderItemsDto } from '../dto/common.dto';

@Controller('sale-quotes/quotes')
@UseGuards(AuthGuard)
export class SaleQuoteController {
  constructor(
    private readonly quoteService: SaleQuoteService,
    private readonly excelService: SaleExcelService,
    private readonly settingsService: SaleSettingsService,
  ) {}

  @Post()
  create(@Body() dto: CreateQuoteDto, @Req() req: AuthenticatedRequest) {
    return this.quoteService.create(dto, req.user);
  }

  @Get()
  findAll(@Query() query: QueryQuoteDto, @Req() req: AuthenticatedRequest) {
    return this.quoteService.findAll(query, req.user);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.quoteService.findOne(id, req.user);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateQuoteDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.quoteService.update(id, dto, req.user);
  }

  @Delete(':id')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.quoteService.remove(id, req.user);
  }

  @Post(':id/duplicate')
  duplicate(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.quoteService.duplicate(id, req.user);
  }

  @Post(':id/items')
  addItem(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: QuoteItemInputDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.quoteService.addItem(id, dto, req.user);
  }

  @Patch(':id/items/:itemId')
  updateItem(
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body() dto: UpdateQuoteItemDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.quoteService.updateItem(id, itemId, dto, req.user);
  }

  @Delete(':id/items/:itemId')
  removeItem(
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.quoteService.removeItem(id, itemId, req.user);
  }

  @Post(':id/items/reorder')
  reorderItems(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReorderItemsDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.quoteService.reorderItems(
      id,
      dto.itemIds,
      req.user,
    );
  }

  @Get(':id/text')
  renderText(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: QuoteTextQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.quoteService.renderText(id, req.user, query);
  }

  @Post('export-raw')
  async exportRawExcel(
    @Body() rawQuote: SaleQuote,
    @Query('type') type: 'internal' | 'customer' = 'customer',
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ) {
    const userId = getUserId(req.user);
    const settings = await this.settingsService.getForUser(userId);
    const buffer = await this.excelService.buildQuoteWorkbook(
      rawQuote,
      type,
      settings,
    );
    const filename = this.formatQuoteFilename(rawQuote?.title);
    this.sendXlsx(res, buffer, filename);
  }

  @Get(':id/export')
  async exportExcel(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: QuoteExportQueryDto,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ) {
    const quote = await this.quoteService.findOne(id, req.user);
    const userId = getUserId(req.user);
    const settings = await this.settingsService.getForUser(userId);
    const buffer = await this.excelService.buildQuoteWorkbook(
      quote,
      query.type || 'customer',
      settings,
    );
    const filename = this.formatQuoteFilename(quote.title);
    this.sendXlsx(res, buffer, filename);
  }

  private formatQuoteFilename(title?: string | null): string {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yy = String(now.getFullYear()).slice(-2);
    const dateStr = `${dd}.${mm}.${yy}`;
    const cleanTitle = (title || '').trim();
    if (cleanTitle) {
      return `BÁO GIÁ_${cleanTitle}_${dateStr}`;
    }
    return `BÁO GIÁ_${dateStr}`;
  }

  private sendXlsx(res: Response, buffer: Buffer, filename: string) {
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    const encoded = encodeURIComponent(filename);
    const asciiFallback = filename.replace(/[^a-zA-Z0-9-_]/g, '-');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiFallback}.xlsx"; filename*=UTF-8''${encoded}.xlsx`,
    );
    res.send(buffer);
  }
}
