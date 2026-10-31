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
  ) {}

  @Post()
  create(@Body() dto: CreateQuoteDto, @Req() req: Request) {
    return this.quoteService.create(dto, (req as any).user);
  }

  @Get()
  findAll(@Query() query: QueryQuoteDto, @Req() req: Request) {
    return this.quoteService.findAll(query, (req as any).user);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request,
  ) {
    return this.quoteService.findOne(id, (req as any).user);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateQuoteDto,
    @Req() req: Request,
  ) {
    return this.quoteService.update(id, dto, (req as any).user);
  }

  @Delete(':id')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request,
  ) {
    return this.quoteService.remove(id, (req as any).user);
  }

  @Post(':id/duplicate')
  duplicate(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request,
  ) {
    return this.quoteService.duplicate(id, (req as any).user);
  }

  @Post(':id/items')
  addItem(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: QuoteItemInputDto,
    @Req() req: Request,
  ) {
    return this.quoteService.addItem(id, dto, (req as any).user);
  }

  @Patch(':id/items/:itemId')
  updateItem(
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body() dto: UpdateQuoteItemDto,
    @Req() req: Request,
  ) {
    return this.quoteService.updateItem(id, itemId, dto, (req as any).user);
  }

  @Delete(':id/items/:itemId')
  removeItem(
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Req() req: Request,
  ) {
    return this.quoteService.removeItem(id, itemId, (req as any).user);
  }

  @Post(':id/items/reorder')
  reorderItems(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReorderItemsDto,
    @Req() req: Request,
  ) {
    return this.quoteService.reorderItems(
      id,
      dto.itemIds,
      (req as any).user,
    );
  }

  @Get(':id/text')
  renderText(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: QuoteTextQueryDto,
    @Req() req: Request,
  ) {
    return this.quoteService.renderText(id, (req as any).user, query);
  }

  @Get(':id/export')
  async exportExcel(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: QuoteExportQueryDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const quote = await this.quoteService.findOne(id, (req as any).user);
    const buffer = await this.excelService.buildQuoteWorkbook(
      quote,
      query.type || 'internal',
    );
    const rawName = (quote.title || quote.quoteCode || `bao-gia-${quote.id}`).trim();
    this.sendXlsx(res, buffer, rawName);
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
