import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product } from './product.entity';
import { ProductPriceHistory } from './product-price-history.entity';
import { ProductWarrantyImporter } from './product-warranty-importer.entity';
import { ProductService } from '../products/product.service';
import { WarrantyImportService } from './warranty-import.service';
import { ProductController } from '../products/product.controller';
import { Brand } from '../brands/brand.entity';
import { Category } from '../categories/category.entity';
import { User } from '../users/user.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Product,
      ProductPriceHistory,
      ProductWarrantyImporter,
      Brand,
      Category,
      User,
    ]),
    AuthModule,
  ],
  providers: [ProductService, WarrantyImportService],
  controllers: [ProductController],
  exports: [ProductService],
})
export class ProductModule {}
