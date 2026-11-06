import { AuthenticatedRequest } from '../types/auth-user.type';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../../common/guards/auth.guard';
import { SaleCatalogService } from '../services/sale-catalog.service';
import { SaleSettingsService } from '../services/sale-settings.service';
import {
  CatalogQueryDto,
  PricingPreviewDto,
  UpdateSettingsDto,
} from '../dto/settings.dto';
import { SaleCategoryQueryDto } from '../dto/category.dto';
import { getUserId } from '../utils/entity-access.util';

@Controller('sale-quotes')
@UseGuards(AuthGuard)
export class SaleCatalogController {
  constructor(
    private readonly catalogService: SaleCatalogService,
    private readonly settingsService: SaleSettingsService,
  ) {}

  @Get('catalog')
  search(@Query() query: CatalogQueryDto, @Req() req: AuthenticatedRequest) {
    return this.catalogService.search(query, req.user);
  }

  /**
   * Danh mục full cho Công cụ hỗ trợ báo giá — không filter theo role.
   * Không dùng endpoint này thay cho CRUD /categories của PM.
   */
  @Get('categories')
  listCategories(@Query() query: SaleCategoryQueryDto) {
    return this.catalogService.listCategories(query);
  }

  @Get('catalog/:id')
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.catalogService.findOne(id, req.user);
  }

  @Post('pricing/preview')
  previewPricing(@Body() dto: PricingPreviewDto, @Req() req: AuthenticatedRequest) {
    return this.catalogService.previewPricing(dto, req.user);
  }

  @Get('settings')
  async getSettings(@Req() req: AuthenticatedRequest) {
    const userId = getUserId(req.user);
    const settings = await this.settingsService.getForUser(userId);
    return this.settingsService.toResponse(settings);
  }

  @Patch('settings')
  async updateSettings(
    @Body() dto: UpdateSettingsDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = getUserId(req.user);
    const settings = await this.settingsService.upsert(userId, dto);
    return this.settingsService.toResponse(settings);
  }
}
