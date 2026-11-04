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
import { SaleBuildService } from '../services/sale-build.service';
import { SaleExcelService } from '../services/sale-excel.service';
import { SaleSettingsService } from '../services/sale-settings.service';
import { getUserId } from '../utils/entity-access.util';
import {
  BuildItemInputDto,
  BuildTextQueryDto,
  CreateBuildDto,
  QueryBuildDto,
  UpdateBuildDto,
  UpdateBuildItemDto,
} from '../dto/build.dto';
import { ReorderItemsDto } from '../dto/common.dto';

@Controller('sale-quotes/builds')
@UseGuards(AuthGuard)
export class SaleBuildController {
  constructor(
    private readonly buildService: SaleBuildService,
    private readonly excelService: SaleExcelService,
    private readonly settingsService: SaleSettingsService,
  ) {}

  @Post()
  create(@Body() dto: CreateBuildDto, @Req() req: AuthenticatedRequest) {
    return this.buildService.create(dto, req.user);
  }

  @Get()
  findAll(@Query() query: QueryBuildDto, @Req() req: AuthenticatedRequest) {
    return this.buildService.findAll(query, req.user);
  }

  @Get('folders')
  listFolders(@Req() req: AuthenticatedRequest) {
    return this.buildService.listFolders(req.user);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.buildService.findOne(id, req.user);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBuildDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.buildService.update(id, dto, req.user);
  }

  @Delete(':id')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.buildService.remove(id, req.user);
  }

  @Post(':id/duplicate')
  duplicate(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.buildService.duplicate(id, req.user);
  }

  @Post(':id/items')
  addItem(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: BuildItemInputDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.buildService.addItem(id, dto, req.user);
  }

  @Patch(':id/items/:itemId')
  updateItem(
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body() dto: UpdateBuildItemDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.buildService.updateItem(id, itemId, dto, req.user);
  }

  @Delete(':id/items/:itemId')
  removeItem(
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.buildService.removeItem(id, itemId, req.user);
  }

  @Post(':id/items/reorder')
  reorderItems(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReorderItemsDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.buildService.reorderItems(
      id,
      dto.itemIds,
      req.user,
    );
  }

  @Get(':id/text')
  renderText(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: BuildTextQueryDto,
    @Query('zaloSuffix') zaloSuffix: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.buildService.renderText(
      id,
      req.user,
      query.includeSpecs ?? false,
      zaloSuffix,
    );
  }

  @Get(':id/export')
  async exportExcel(
    @Param('id', ParseIntPipe) id: number,
    @Query('type') type: 'internal' | 'customer' = 'internal',
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ) {
    const build = await this.buildService.findOne(id, req.user);
    const userId = getUserId(req.user);
    const settings = await this.settingsService.getForUser(userId);
    const buffer = await this.excelService.buildBuildWorkbook(
      build,
      type === 'customer' ? 'customer' : 'internal',
      settings,
    );
    this.sendXlsx(res, buffer, `cau-hinh-${build.id}`);
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
