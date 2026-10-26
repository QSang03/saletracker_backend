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
  ) {}

  @Post()
  create(@Body() dto: CreateQuickCaseDto, @Req() req: Request) {
    return this.quickCaseService.create(dto, (req as any).user);
  }

  @Post('bulk')
  createBulk(@Body() dto: BulkQuickCaseDto, @Req() req: Request) {
    return this.quickCaseService.createBulk(dto, (req as any).user);
  }

  @Get()
  findAll(@Query() query: QueryQuickCaseDto, @Req() req: Request) {
    return this.quickCaseService.findAll(query, (req as any).user);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request,
  ) {
    return this.quickCaseService.findOne(id, (req as any).user);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateQuickCaseDto,
    @Req() req: Request,
  ) {
    return this.quickCaseService.update(id, dto, (req as any).user);
  }

  @Delete(':id')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request,
  ) {
    return this.quickCaseService.remove(id, (req as any).user);
  }

  @Post(':id/duplicate')
  duplicate(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request,
  ) {
    return this.quickCaseService.duplicate(id, (req as any).user);
  }

  @Post(':id/items')
  addItem(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: QuickCaseItemInputDto,
    @Req() req: Request,
  ) {
    return this.quickCaseService.addItem(id, dto, (req as any).user);
  }

  @Patch(':id/items/:itemId')
  updateItem(
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body() dto: UpdateQuickCaseItemDto,
    @Req() req: Request,
  ) {
    return this.quickCaseService.updateItem(
      id,
      itemId,
      dto,
      (req as any).user,
    );
  }

  @Delete(':id/items/:itemId')
  removeItem(
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Req() req: Request,
  ) {
    return this.quickCaseService.removeItem(
      id,
      itemId,
      (req as any).user,
    );
  }

  @Post(':id/items/reorder')
  reorderItems(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReorderItemsDto,
    @Req() req: Request,
  ) {
    return this.quickCaseService.reorderItems(
      id,
      dto.itemIds,
      (req as any).user,
    );
  }

  @Get(':id/text')
  renderText(
    @Param('id', ParseIntPipe) id: number,
    @Query('zaloSuffix') zaloSuffix: string | undefined,
    @Req() req: Request,
  ) {
    return this.quickCaseService.renderText(
      id,
      (req as any).user,
      zaloSuffix,
    );
  }

  @Get(':id/export')
  async exportExcel(
    @Param('id', ParseIntPipe) id: number,
    @Query('type') type: 'internal' | 'customer' = 'internal',
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const quickCase = await this.quickCaseService.findOne(
      id,
      (req as any).user,
    );
    const buffer = await this.excelService.buildQuickCaseWorkbook(
      quickCase,
      type === 'customer' ? 'customer' : 'internal',
    );
    this.sendXlsx(res, buffer, `bao-gia-nhanh-${quickCase.id}`);
  }

  private sendXlsx(res: Response, buffer: Buffer, filename: string) {
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename.replace(/[^a-zA-Z0-9-_]/g, '-')}.xlsx"`,
    );
    res.send(buffer);
  }
}
