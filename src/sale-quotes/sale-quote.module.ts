import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Product } from '../products/product.entity';
import { Category } from '../categories/category.entity';
import { SaleQuoteSetting } from './entities/sale-quote-setting.entity';
import { SaleQuote } from './entities/sale-quote.entity';
import { SaleQuoteItem } from './entities/sale-quote-item.entity';
import { SaleBuild } from './entities/sale-build.entity';
import { SaleBuildItem } from './entities/sale-build-item.entity';
import { SaleQuickQuoteCase } from './entities/sale-quick-quote-case.entity';
import { SaleQuickQuoteItem } from './entities/sale-quick-quote-item.entity';
import { SaleExcelCatalog } from './entities/sale-excel-catalog.entity';
import { SaleExcelSheet } from './entities/sale-excel-sheet.entity';
import { SaleExcelItem } from './entities/sale-excel-item.entity';
import { SaleExcelPermission } from './entities/sale-excel-permission.entity';
import { SaleExcelTemplate } from './entities/sale-excel-template.entity';
import { User } from '../users/user.entity';

import { SaleSettingsService } from './services/sale-settings.service';
import { SalePricingService } from './services/sale-pricing.service';
import { SaleTextRendererService } from './services/sale-text-renderer.service';
import { SaleCatalogService } from './services/sale-catalog.service';
import { SaleQuoteService } from './services/sale-quote.service';
import { SaleBuildService } from './services/sale-build.service';
import { SaleQuickCaseService } from './services/sale-quick-case.service';
import { SaleExcelService } from './services/sale-excel.service';
import { SaleExcelParserService } from './services/sale-excel-parser.service';
import { SaleExcelCatalogService } from './services/sale-excel-catalog.service';

import { SaleCatalogController } from './controllers/sale-catalog.controller';
import { SaleQuoteController } from './controllers/sale-quote.controller';
import { SaleBuildController } from './controllers/sale-build.controller';
import { SaleQuickCaseController } from './controllers/sale-quick-case.controller';
import { SaleExcelCatalogController } from './controllers/sale-excel-catalog.controller';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([
      Product,
      Category,
      User,
      SaleQuoteSetting,
      SaleQuote,
      SaleQuoteItem,
      SaleBuild,
      SaleBuildItem,
      SaleQuickQuoteCase,
      SaleQuickQuoteItem,
      SaleExcelCatalog,
      SaleExcelSheet,
      SaleExcelItem,
      SaleExcelPermission,
      SaleExcelTemplate,
    ]),
  ],
  controllers: [
    SaleCatalogController,
    SaleQuoteController,
    SaleBuildController,
    SaleQuickCaseController,
    SaleExcelCatalogController,
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
    SaleExcelParserService,
    SaleExcelCatalogService,
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
    SaleExcelParserService,
    SaleExcelCatalogService,
  ],
})
export class SaleQuoteModule {}
