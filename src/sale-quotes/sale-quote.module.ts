import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Product } from '../products/product.entity';
import { SaleQuoteSetting } from './entities/sale-quote-setting.entity';
import { SaleQuote } from './entities/sale-quote.entity';
import { SaleQuoteItem } from './entities/sale-quote-item.entity';
import { SaleBuild } from './entities/sale-build.entity';
import { SaleBuildItem } from './entities/sale-build-item.entity';
import { SaleQuickQuoteCase } from './entities/sale-quick-quote-case.entity';
import { SaleQuickQuoteItem } from './entities/sale-quick-quote-item.entity';

import { SaleSettingsService } from './services/sale-settings.service';
import { SalePricingService } from './services/sale-pricing.service';
import { SaleTextRendererService } from './services/sale-text-renderer.service';
import { SaleCatalogService } from './services/sale-catalog.service';
import { SaleQuoteService } from './services/sale-quote.service';
import { SaleBuildService } from './services/sale-build.service';
import { SaleQuickCaseService } from './services/sale-quick-case.service';
import { SaleExcelService } from './services/sale-excel.service';

import { SaleCatalogController } from './controllers/sale-catalog.controller';
import { SaleQuoteController } from './controllers/sale-quote.controller';
import { SaleBuildController } from './controllers/sale-build.controller';
import { SaleQuickCaseController } from './controllers/sale-quick-case.controller';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([
      Product,
      SaleQuoteSetting,
      SaleQuote,
      SaleQuoteItem,
      SaleBuild,
      SaleBuildItem,
      SaleQuickQuoteCase,
      SaleQuickQuoteItem,
    ]),
  ],
  controllers: [
    SaleCatalogController,
    SaleQuoteController,
    SaleBuildController,
    SaleQuickCaseController,
  ],
  providers: [
    SaleSettingsService,
    SalePricingService,
    SaleTextRendererService,
    SaleCatalogService,
    SaleQuoteService,
    SaleBuildService,
    SaleQuickCaseService,
    SaleExcelService,
  ],
  exports: [
    SaleSettingsService,
    SalePricingService,
    SaleTextRendererService,
    SaleCatalogService,
    SaleQuoteService,
    SaleBuildService,
    SaleQuickCaseService,
    SaleExcelService,
  ],
})
export class SaleQuoteModule {}
