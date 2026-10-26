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
import { getUserId } from '../utils/entity-access.util';

@Controller('sale-quotes')
@UseGuards(AuthGuard)
export class SaleCatalogController {
  constructor(
    private readonly catalogService: SaleCatalogService,
    private readonly settingsService: SaleSettingsService,
  ) {}

  @Get('catalog')
  search(@Query() query: CatalogQueryDto, @Req() req: Request) {
    return this.catalogService.search(query, (req as any).user);
  }

  @Get('catalog/:id')
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request,
  ) {
    return this.catalogService.findOne(id, (req as any).user);
  }

  @Post('pricing/preview')
  previewPricing(@Body() dto: PricingPreviewDto, @Req() req: Request) {
    return this.catalogService.previewPricing(dto, (req as any).user);
  }

  @Get('settings')
  async getSettings(@Req() req: Request) {
    const userId = getUserId((req as any).user);
    const settings = await this.settingsService.getForUser(userId);
    return this.settingsService.toResponse(settings);
  }

  @Patch('settings')
  async updateSettings(
    @Body() dto: UpdateSettingsDto,
    @Req() req: Request,
  ) {
    const userId = getUserId((req as any).user);
    const settings = await this.settingsService.upsert(userId, dto);
    return this.settingsService.toResponse(settings);
  }
}
